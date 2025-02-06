import * as path from 'path';
import { FileEntry } from "ssh2-streams";
import * as vscode from 'vscode';
import { TreeItemCollapsibleState } from "vscode";
import { Command, NodeType } from "../common/constant";
import { Util } from '../common/util';
import { ViewManager } from '../common/viewManager';
import { ClientManager } from "../manager/clientManager";
import { FileManager, FileModel } from '../manager/fileManager';
import ServiceManager from '../manager/serviceManager';
import { TerminalService } from '../service/terminal/terminalService';
import { XtermTerminal } from '../service/terminal/xtermTerminalService';
import AbstractNode from "./abstracNode";
import { FileNode } from './fileNode';
import { SSHConfig, getSshConfigIdentifier } from "./sshConfig";
import { ForwardService } from '../service/forward/forwardService';
var progressStream = require('progress-stream');
import { error } from 'console';
import { Console } from '../common/outputChannel';
import { InfoNode, LinkNode } from './infoNode';
import prettyBytes = require('pretty-bytes');
import { exec } from 'child_process';
import { createReadStream, createWriteStream, fstatSync, statSync } from 'fs';
import { SFTPWrapper } from 'ssh2';

/**
 * contains connection and folder
 */
export class ParentNode extends AbstractNode {

    private terminalService: TerminalService = new XtermTerminal();

    constructor(readonly sshConfig: SSHConfig, readonly name: string, readonly file?: FileEntry, readonly parentName?: string, iconPath?: string) {
        super(name, TreeItemCollapsibleState.Collapsed);
        this.id = file ? `${sshConfig.username}@${sshConfig.host}_${sshConfig.port}_${parentName}.${name}` : `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`;
        this.fullPath = this.parentName + this.name;
        if (!file) {
            this.contextValue = NodeType.CONNECTION;
            this.iconPath = path.join(ServiceManager.context.extensionPath, 'resources', 'image', `chain.svg`);
        } else {
            this.contextValue = NodeType.FOLDER;
            this.iconPath = path.join(ServiceManager.context.extensionPath, 'resources', 'image', `folder.svg`);
        }
        if (file && file.filename.toLocaleLowerCase() == "home") {
            this.iconPath = `${ServiceManager.context.extensionPath}/resources/image/folder-core.svg`;
        } else if (iconPath) {
            this.iconPath = iconPath;
        }
    }

    public copyIP() {
        Util.copyToBoard(this.sshConfig.host)
    }

    public startSocksProxy() {
        var exec = require('child_process').exec;
        if (this.sshConfig.private) {
            exec(`cmd /c start ssh -i ${this.sshConfig.private} -qTnN -D 127.0.0.1:1080 root@${this.sshConfig.host}`)
        }else{
            exec(`cmd /c start ssh -qTnN -D 127.0.0.1:1080 root@${this.sshConfig.host}`)
        }
    }

    private forwardService = new ForwardService()
    public fowardPort() {
        this.forwardService.createForwardView(this.sshConfig)
    }

    public newFile(): any {
        vscode.window.showInputBox().then(async input => {
            if (input) {
                const { sftp } = await ClientManager.getSSH(this.sshConfig)
                const fullLocalPath = getSshConfigIdentifier(this.sshConfig) + this.fullPath;
                const tempPath = await FileManager.recordFile("temp/" + fullLocalPath, input, "", FileModel.WRITE);
                const targetPath = this.fullPath + "/" + input;
                sftp.fastPut(tempPath, targetPath, err => {
                    if (err) {
                        vscode.window.showErrorMessage(err.message)
                    } else {
                        vscode.commands.executeCommand(Command.REFRESH)
                    }
                })
            } else {
                vscode.window.showInformationMessage("Create File Cancel!")
            }
        })
    }


    async syncLocal() {
        const { sftp } = await ClientManager.getSSH(this.sshConfig);
        const fullLocalPath = getSshConfigIdentifier(this.sshConfig) + this.fullPath;

        vscode.window.showInformationMessage("Syncing " + this.name + "...")

        // get a tree of files from this folder on the remote server recursively
        let tree = await this.getRemoteTree(sftp, this.fullPath);

        // download all files from the remote server to the local machine recursively
        await this.downloadRemoteTree(sftp, tree, fullLocalPath);

        vscode.window.showInformationMessage("Sync " + this.name + " success!")
    }

    async downloadRemoteTree(sftp: SFTPWrapper, tree: Object, localPath: string) {
        // ignore folders, they will be created when a file is recorded. use FileManager.recordFile
        for (let [key, value] of Object.entries(tree)) {
            if (value.attrs) {
                const tempPath = await FileManager.recordFile("temp/" + localPath, key, "", FileModel.WRITE);
                sftp.fastGet(this.fullPath + "/" + key, tempPath, err => {
                    if (err) {
                        vscode.window.showErrorMessage(err.message)
                    }
                })
            } else {
                await this.downloadRemoteTree(sftp, value, localPath + "/" + key)
            }
        }
    }

    async getRemoteTree(sftp, path, tree = {}) {
        return new Promise((resolve, reject) => {
            sftp.readdir(path, (err, list) => {
                if (err) {
                    reject(err)
                }
                list.forEach(async (item) => {
                    if (item.filename.startsWith(".")) {
                        return
                    }
                    if (item.longname.startsWith("d")) {
                        tree[item.filename] = await this.getRemoteTree(sftp, path + '/' + item.filename)
                    } else {
                        tree[item.filename] = item
                    }
                })
                resolve(tree)
            })
        })
    }

    public newFolder(): any {
        vscode.window.showInputBox().then(async input => {
            if (input) {
                const { sftp } = await ClientManager.getSSH(this.sshConfig)
                sftp.mkdir(this.fullPath + "/" + input, err => {
                    if (err) {
                        vscode.window.showErrorMessage(err.message)
                    } else {
                        vscode.commands.executeCommand(Command.REFRESH)
                    }
                })
            } else {
                vscode.window.showInformationMessage("Create Folder Cancel!")
            }
        })
    }

    upload(): any {
        vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, canSelectFolders: false, openLabel: "Select Upload Path" })
            .then(async uri => {
                if (uri) {
                    const { sftp } = await ClientManager.getSSH(this.sshConfig)
                    const targetPath = uri[0].fsPath;

                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Start uploading ${targetPath}`,
                        cancellable:true
                    }, (progress, token) => {
                        return new Promise((resolve) => {
                            const fileReadStream = createReadStream(targetPath)
                            var str = progressStream({
                                length: statSync(targetPath).size,
                                time: 100
                            });
                            let before=0;
                            str.on("progress", (progressData: any) => {
                                if (progressData.percentage == 100) {
                                    resolve(null)
                                    vscode.window.showInformationMessage(`Upload ${targetPath} success, cost time: ${progressData.runtime}s`)
                                    return;
                                }
                                progress.report({ increment: progressData.percentage-before,message:`remaining : ${prettyBytes(progressData.remaining)}` });
                                before=progressData.percentage
                            })
                            str.on("error",err=>{
                                vscode.window.showErrorMessage(err.message)
                            })
                            const outStream = sftp.createWriteStream(this.fullPath + "/" + path.basename(targetPath));
                            fileReadStream.pipe(str).pipe(outStream);
                            token.onCancellationRequested(() => {
                                fileReadStream.destroy()
                                outStream.destroy()
                            });
                        })
                    })

                    // const start = new Date()
                    // vscode.window.showInformationMessage(`Start uploading ${targetPath}.`)
                    // sftp.fastPut(targetPath, this.fullPath + "/" + path.basename(targetPath), err => {
                    //     if (err) {
                    //         vscode.window.showErrorMessage(err.message)
                    //     } else {
                    //         vscode.window.showInformationMessage(`Upload ${this.fullPath} success, cost time: ${new Date().getTime() - start.getTime()}`)
                    //         vscode.commands.executeCommand(Command.REFRESH)
                    //     }
                    // })
                }
            })
    }

    delete(): any {
        // vscode.window.showQuickPick(["YES", "NO"], { canPickMany: false }).then(async str => {
        //     if (str == "YES") {
        //         const { sftp } = await ClientManager.getSSH(this.sshConfig)
        //         sftp.rmdir(this.fullPath, (err) => {
        //             if (err) {
        //                 vscode.window.showErrorMessage(err.message)
        //             } else {
        //                 vscode.commands.executeCommand(Command.REFRESH)
        //             }
        //         })
        //     }
        // })

        vscode.window.showInformationMessage(
            `Are you sure you want to delete '${this.fullPath}'? This action cannot be undone.`,
            { modal: true },
            "Yes",
            "No").then(async str => {
            if (str == "Yes") {
                const { sftp } = await ClientManager.getSSH(this.sshConfig)
                // recursively
                sftp.rmdir(this.fullPath, { recursive: true, force: true }, (err) => {
                    if (err) {
                        vscode.window.showErrorMessage(err.message)
                    } else {
                        vscode.commands.executeCommand(Command.REFRESH)
                    }
                })
            }
        })
    }

    openTerminal(): any {
        this.terminalService.openMethod(this.sshConfig)
    }

    openInTeriminal(): any {
        this.terminalService.openPath(this.sshConfig, this.fullPath)
    }

    async getChildren(): Promise<AbstractNode[]> {

        return new Promise(async (resolve) => {
            try {
                console.log("getting children");
                const ssh = await ClientManager.getSSH(this.sshConfig);
                console.log("got children");
                ssh.sftp.readdir(this.file ? this.parentName + this.name : '/', (err, fileList) => {
                    console.log(err, fileList);
                    if (err) {
                        resolve([new InfoNode(err.message)]);
                    } else if (fileList.length == 0) {
                        resolve([new InfoNode("There are no files in this folder.")]);
                    } else {
                        const parent = this.file ? `${this.parentName + this.name}/` : '/';
                        resolve(this.build(fileList, parent))
                    }
                })
            } catch (err) {
                console.log("error004", err);
                resolve([new InfoNode(err.message)])
            }
        })
    }

    build(entryList: FileEntry[], parentName: string): AbstractNode[] {

        const folderList: AbstractNode[] = []
        const fileList: AbstractNode[] = []

        for (const entry of entryList) {
            if (entry.longname.startsWith("d")) {
                folderList.push(new ParentNode(this.sshConfig, entry.filename, entry, parentName))
            } else if (entry.longname.startsWith("l")) {
                fileList.push(new LinkNode(entry.filename))
            } else {
                fileList.push(new FileNode(this.sshConfig, entry, parentName))
            }
        }

        return [].concat(folderList.sort((a, b) => a.label.localeCompare(b.label)))
            .concat(fileList.sort((a, b) => a.label.localeCompare(b.label)));
    }


    public openFileZilla() {
        // For convenience:
        const { username, password, host, port } = this.sshConfig;
    
        // This only makes sense if there's a password. If user has only a private key,
        // obviously "username:password@..." won't work, so you may want to handle that.
        if (!password) {
          vscode.window.showErrorMessage('No password found for this connection. FileZilla command needs a password!');
          return;
        }
    
        // Construct the FileZilla sftp URL
        const sftpUrl = `sftp://${username}:${password}@${host}:${port}`;
    
        // The command to run (Mac example):
        const filezillaPath = '/Applications/FileZilla.app/Contents/MacOS/filezilla';
    
        // Execute FileZilla with the sftp URL
        exec(`"${filezillaPath}" "${sftpUrl}"`, (err) => {
          if (err) {
            vscode.window.showErrorMessage(`Failed to open FileZilla: ${err.message}`);
          }
        });
      }



}
