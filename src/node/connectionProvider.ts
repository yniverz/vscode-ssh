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
                    try {
                        const sshConfig = config[key];
                        if (sshConfig.private && existsSync(sshConfig.private)) {
                            sshConfig.privateKey = require('fs').readFileSync(sshConfig.private)
                        }
                        const nodeKey = `${sshConfig.name ? sshConfig.name + "_" : ""}${key}`;
                        return new ParentNode(sshConfig, nodeKey);
                    } catch (nodeError) {
                        console.log("Error creating node for key:", key, nodeError);
                        return new InfoNode(`Error creating connection node: ${nodeError.message}. Try using 'Recover Connection' command.`);
                    }
                }).filter(node => node !== null); // Filter out any null nodes
                
                nodes.sort((a, b) => a.label.localeCompare(b.label));
                return nodes;
            } else {
                try {
                    return await element.getChildren();
                } catch (childrenError) {
                    console.log("Error getting children for element:", element.label, childrenError);
                    return [new InfoNode(`Error loading folder contents: ${childrenError.message}. Try using 'Recover Connection' command.`)];
                }
            }
        } catch (error) {
            console.log("error002", error);
            return [new InfoNode(`Connection error: ${error.message}. Try using 'Recover Connection' command.`)];
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

    // Force refresh of a specific element to help recover from errors
    refreshElement(element?: AbstractNode) {
        if (element) {
            this._onDidChangeTreeData.fire(element);
        } else {
            this._onDidChangeTreeData.fire();
        }
    }

    // Clear connection cache to force reconnection
    async clearConnectionCache() {
        try {
            // Clear all SSH connections to force reconnection
            const { ClientManager } = await import('../manager/clientManager');
            ClientManager.clearAllConnections();
            
            // Refresh the tree view to trigger reconnection
            this.refresh();
            
            vscode.window.showInformationMessage("Connection cache cleared. Reconnecting...");
        } catch (error) {
            console.log("Error clearing connection cache:", error);
            vscode.window.showErrorMessage(`Failed to clear connection cache: ${error.message}`);
        }
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
                }).on("CONNECT_TO_SQL_SERVER", async (content) => {
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

                    try {
                        // First try to test the connection
                        await ClientManager.getSSH(sshConfig, false);
                        // If successful, save the connection
                        const id = `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`;
                        const configs = this.getConnections();
                        configs[id] = sshConfig;
                        this.context.globalState.update(CacheKey.CONECTIONS_CONFIG, configs);
                        handler.emit('CONNECTION_SUCCESS', 'Connection added successfully!');
                        handler.panel.dispose()
                        this.refresh();
                    } catch (err) {
                        console.log("error003", err);
                        // Connection failed, ask user if they want to add it anyway
                        const choice = await vscode.window.showWarningMessage(
                            `Connection failed: ${err.message}\n\nWould you like to add this connection anyway? You can check your connection information later.`,
                            'Add Anyway', 'Cancel'
                        );
                        
                        if (choice === 'Add Anyway') {
                            // Save the connection even though it failed
                            const id = `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`;
                            const configs = this.getConnections();
                            configs[id] = sshConfig;
                            this.context.globalState.update(CacheKey.CONECTIONS_CONFIG, configs);
                            handler.emit('CONNECTION_SUCCESS', 'Connection added successfully! You can try connecting again later.');
                            handler.panel.dispose()
                            this.refresh();
                            vscode.window.showInformationMessage('Connection added successfully. You can try connecting again later.');
                        } else {
                            // User chose to cancel, show the error
                            handler.emit('CONNECTION_ERROR', err.message)
                        }
                    }

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