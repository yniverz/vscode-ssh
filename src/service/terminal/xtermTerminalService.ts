import { Client } from "ssh2";
import * as vscode from 'vscode';
import { Hanlder, ViewManager } from "../../common/viewManager";
import { FileManager, FileModel } from "../../manager/fileManager";
import { SSHConfig } from "../../node/sshConfig";
import { TerminalService } from "./terminalService";
import { Util } from "../../common/util";
import { TerminalTitle } from "./constant";

export class XtermTerminal implements TerminalService {

    private getSshUrl(sshConfig: SSHConfig): string {
        return 'ssh://' + sshConfig.username + '@' + sshConfig.host + ':' + sshConfig.port;
    }

    private static handlerMap = new Map<string, Hanlder>();

    public async openPath(sshConfig: SSHConfig, fullPath: string) {
        const handler = XtermTerminal.handlerMap[this.getSshUrl(sshConfig)]
        if (handler) {
            handler.emit('path', fullPath)
        } else {
            this.openMethod(sshConfig, () => { this.openPath(sshConfig, fullPath) })
        }
    }

    public async openMethod(sshConfig: SSHConfig, callback?: () => void) {

        ViewManager.createWebviewPanel({
            splitView: false, path: "client", iconPath: {
                light: Util.getExtPath("resources", "image", "light", "terminal.png"),
                dark: Util.getExtPath("resources", "image","dark", "terminal.svg"),
            },
            title: this.getTitle(sshConfig),
            eventHandler: (handler) => {
                this.handlerEvent(handler, sshConfig, callback)
            }
        })

    }

    private handlerEvent(handler: Hanlder, sshConfig: SSHConfig, callback?: () => void) {

        const sshUrl = this.getSshUrl(sshConfig);
        let dataBuffer = [];
        handler.on("init", (content) => {
            handler.emit('connecting', `connecting ${sshConfig.username}@${sshConfig.host}...\n`);
            let termCols: number, termRows: number;
            if (content) {
                termCols = content.cols;
                termRows = content.rows
            }
            const client = new Client()
            const end = () => { client.end(); XtermTerminal.handlerMap[sshUrl] = null; }
            const SSHerror = (message: string, err: any) => { handler.emit('ssherror', (err) ? `${message}: ${err.message}` : message); end(); }
            client.on('ready', () => {
                XtermTerminal.handlerMap[sshUrl] = handler
                client.shell({ term: 'xterm-color', cols: termCols, rows: termRows }, (err, stream) => {
                    if (err) {
                        SSHerror('EXEC ERROR' + err, null)
                        return
                    }
                    handler.emit('header', '')
                    handler.emit('status', 'SSH CONNECTION ESTABLISHED')
                    handler.on('data', (data: string) => {
                        stream.write(data)
                    }).on('resize', (data) => {
                        stream.setWindow(data.rows, data.cols, data.height, data.width)
                    }).on('openLink', uri => {
                        vscode.env.openExternal(vscode.Uri.parse(uri));
                    }).on('dispose', () => {
                        end()
                    })
                    stream.on('data', (data) => {
                        handler.emit('data', data.toString('utf-8'));
                        dataBuffer = dataBuffer.concat(data)
                    })
                    stream.on('close', (code, signal) => {
                        handler.emit('ssherror', 'ssh session is close.')
                        end()
                    })
                    if (callback && (typeof callback) == "function")
                        callback()
                })
            })
            // client.on('banner', (data: string) => handler.emit('data', data.replace(/\r?\n/g, '\r\n')))
            client.on('end', (err) => { SSHerror('CONN END BY HOST', err) })
            client.on('close', (err) => { SSHerror('CONN CLOSE', err) })
            client.on('error', (err) => { SSHerror('CONN ERROR', err) })
            client.on('keyboard-interactive', () => {
                end();
            })
            client.connect(sshConfig)
        }).on('openLog', async () => {
            const filePath = sshConfig.username + '@' + sshConfig.host
            await FileManager.record(filePath, dataBuffer.toString().replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, ''), FileModel.WRITE)
            FileManager.show(filePath).then((textEditor: vscode.TextEditor) => {
                const lineCount = textEditor.document.lineCount;
                const range = textEditor.document.lineAt(lineCount - 1).range;
                textEditor.selection = new vscode.Selection(range.end, range.end);
                textEditor.revealRange(range);
            })
        })

    }

    private getTitle(sshConfig: SSHConfig): string {
        const type = vscode.workspace.getConfiguration("vscode-ssh").get<TerminalTitle>("terimanlTitle");
        if (type == TerminalTitle.connectionName && sshConfig.name) {
            return sshConfig.name;
        }
        return `${sshConfig.username}@${sshConfig.host}`
    }

}