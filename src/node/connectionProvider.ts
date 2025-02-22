import * as vscode from 'vscode';
import * as path from 'path';
import { Event, EventEmitter, ExtensionContext, TreeDataProvider, window } from "vscode";
import { CacheKey, Command } from "../common/constant";
import { ParentNode } from "./parentNode";
import { SSHConfig } from "./sshConfig";
import AbstractNode from './abstracNode';
import { ClientManager } from '../manager/clientManager';
import { ViewManager } from '../common/viewManager';
import { existsSync } from 'fs';
import { Util } from '../common/util';
import { InfoNode } from './infoNode';


export default class ConnectionProvider implements TreeDataProvider<AbstractNode> {
    _onDidChangeTreeData: EventEmitter<AbstractNode> = new EventEmitter<AbstractNode>();
    readonly onDidChangeTreeData: Event<AbstractNode> = this._onDidChangeTreeData.event;
    public static tempRemoteMap = new Map<string, { remote: string, sshConfig: SSHConfig }>()

    constructor(private context: ExtensionContext) {
        vscode.workspace.onDidSaveTextDocument(e => {
            const tempPath = path.resolve(e.fileName);
            const data = ConnectionProvider.tempRemoteMap.get(tempPath)
            if (data) {
                this.saveFile(tempPath, data.remote, data.sshConfig)
            }
        })
    }
    getTreeItem(element: AbstractNode): vscode.TreeItem {
        return element;
    }

    // usage: https://www.npmjs.com/package/redis
    async getChildren(element?: AbstractNode) {
        try {
            if (!element) {
                const config = this.getConnections();
                const nodes = Object.keys(config).map(key => {
                    const sshConfig = config[key];
                    if (sshConfig.private && existsSync(sshConfig.private)) {
                        sshConfig.privateKey = require('fs').readFileSync(sshConfig.private)
                    }
                    key=`${sshConfig.name ? sshConfig.name + "_" : ""}${key}`
                    return new ParentNode(sshConfig, key);
                });
                nodes.sort((a, b) => a.label.localeCompare(b.label));
                return nodes
            } else {
                return element.getChildren()
            }
        } catch (error) {
            console.log("error002", error);
            return [new InfoNode(error)]
        }
    }

    async saveFile(tempPath: string, remotePath: string, sshConfig: SSHConfig) {
        const { sftp } = await ClientManager.getSSH(sshConfig)
        sftp.fastPut(tempPath, remotePath, async (err) => {
            if (err) {
                vscode.window.showErrorMessage(err.message)
            } else {
                vscode.commands.executeCommand(Command.REFRESH)
                vscode.window.showInformationMessage("Update to remote success!")
            }
        })
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    async save(parentNode?: ParentNode) {

        ViewManager.createWebviewPanel({
            iconPath: Util.getExtPath("resources", "image", "icon", "add.svg"),
            path: "connect", title: "Add SSH Config", splitView: false,
            eventHandler: (handler) => {
                handler.on("init", () => {
                    if(parentNode){
                        if(!parentNode.sshConfig.algorithms){
                            parentNode.sshConfig.algorithms={cipher:[]}
                        }
                        handler.emit("edit",parentNode.sshConfig)
                    }
                }).on("CONNECT_TO_SQL_SERVER", (content) => {
                    const sshConfig: SSHConfig = content.connectionOption
                    let msg = null;
                    if (!sshConfig.username) {
                        msg = "You must input username!"
                    }
                    if (!sshConfig.password && !sshConfig.private) {
                        msg = "You must input password!"
                    }
                    if (!sshConfig.host) {
                        msg = "You must input host!"
                    }
                    if (!sshConfig.port) {
                        msg = "You must input port!"
                    }
                    if (msg) {
                        handler.emit('CONNECTION_ERROR', msg)
                        return;
                    }

                    ClientManager.getSSH(sshConfig,false).then(() => {
                        const id = `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`;
                        const configs = this.getConnections();
                        configs[id] = sshConfig;
                        this.context.globalState.update(CacheKey.CONECTIONS_CONFIG, configs);
                        handler.panel.dispose()
                        this.refresh();
                    }).catch(err => {
                        console.log("error003", err);
                        handler.emit('CONNECTION_ERROR', err.message)
                    })

                })
            }
        })

    }

    delete(element: ParentNode) {
        Util.confirm(`Are you want remove connection ${element.sshConfig.username}@${element.sshConfig.host}?`, () => {
            const configs = this.getConnections();
            delete configs[element.id];
            this.context.globalState.update(CacheKey.CONECTIONS_CONFIG, configs);
            this.refresh();
        })
    }

    private getConnections(): { [key: string]: SSHConfig } {
        return this.context.globalState.get<{ [key: string]: SSHConfig }>(CacheKey.CONECTIONS_CONFIG) || {};
    }

}