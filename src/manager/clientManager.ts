import * as vscode from 'vscode';
import { Client, SFTPWrapper } from "ssh2";
import { SSHConfig } from "../node/sshConfig";
import { existsSync, readFileSync } from 'fs';

export class SSH {
    client: Client;
    sftp: SFTPWrapper;
}

export class ClientManager {

    private static activeClient: { [key: string]: SSH } = {};

    public static getSSH(sshConfig: SSHConfig, withSftp: boolean=true): Promise<SSH> {

        const key = `${sshConfig.host}_${sshConfig.port}_${sshConfig.username}`;

        // Check if an active client exists
        if (this.activeClient[key]) {
            const { client, sftp } = this.activeClient[key];

            return new Promise((resolve, reject) => {
                console.log("Testing existing connection...");

    
                var timeout = setTimeout(()=>{
                    console.log("reached connection timeout.");
                    this.fail(client, key, sshConfig, withSftp, resolve, reject)
                }, 1000*10);

                // Test the connection with a lightweight command
                client.exec('echo "ping"', (err, stream) => {
                    clearTimeout(timeout);

                    if (err) {
                        this.fail(client, key, sshConfig, withSftp, resolve, reject)
                    } else {
                        stream.on('close', () => {
                            console.log("Active connection is valid");
                            resolve(this.activeClient[key]); // Return the existing valid connection
                        })
                        .on('data', () => {}) // Handle command output (optional)
                        .stderr.on('data', () => {}); // Handle stderr output (optional)
                    }
                });
            });
        }

        vscode.window.showInformationMessage("Establishing connection...");

        return new Promise((resolve, reject) => {
            this.createNewConnection(sshConfig, withSftp, resolve, reject);
        });

    }

    public static fail(
        cl: Client, 
        key: string,
        sshConfig: SSHConfig,
        withSftp: boolean,
        resolve: (value: SSH) => void,
        reject: (reason?: any) => void) {
            
        console.log("Connection test failed, removing stale connection");
        cl.end(); // Ensure the stale connection is cleaned up
        delete this.activeClient[key];

        vscode.window.showInformationMessage("Re-establishing connection...");
        // Proceed to establish a new connection
        this.createNewConnection(sshConfig, withSftp, resolve, reject);
    }

    private static createNewConnection(
        sshConfig: SSHConfig,
        withSftp: boolean,
        resolve: (value: SSH) => void,
        reject: (reason?: any) => void
    ): void {
        const key = `${sshConfig.host}_${sshConfig.port}_${sshConfig.username}`;
        if (sshConfig.private && !sshConfig.privateKey && existsSync(sshConfig.private)) {
            sshConfig.privateKey = readFileSync(sshConfig.private);
        }
    
        const client = new Client();
        client.on('ready', () => {
            console.log("SSH connection ready");
            if (withSftp) {
                client.sftp((err, sftp) => {
                    if (err) {
                        console.error("Error creating SFTP session:", err.message);
                        reject(err);
                        return;
                    }
                    this.activeClient[key] = { client, sftp };
                    resolve(this.activeClient[key]);
                });
            } else {
                this.activeClient[key] = { client, sftp: null };
                resolve(this.activeClient[key]);
            }
        }).on('error', (err) => {
            if (!err.message.includes('ECONNRESET')) {
                vscode.window.showErrorMessage(err.message);
            }
            console.log("Error establishing SSH connection:", err.message);
            reject(err);
        }).on('end', () => {
            console.log("SSH connection ended");
            delete this.activeClient[key];
        }).connect({ ...sshConfig, readyTimeout: 1000 * 10 });
    }

}

