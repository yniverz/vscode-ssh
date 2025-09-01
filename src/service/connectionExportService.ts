import * as vscode from 'vscode';
import { SSHConfig } from '../node/sshConfig';
import { CacheKey } from '../common/constant';
import * as fs from 'fs';
import * as path from 'path';

export class ConnectionExportService {
    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Export all connections to XML format
     */
    async exportConnections(): Promise<void> {
        try {
            const connections = this.getConnections();
            
            if (Object.keys(connections).length === 0) {
                vscode.window.showWarningMessage('No connections to export.');
                return;
            }

            // Create XML content
            const xmlContent = this.generateXML(connections);
            
            // Show save dialog
            const uri = await vscode.window.showSaveDialog({
                filters: {
                    'XML Files': ['xml']
                },
                defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'ssh-connections.xml'))
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(xmlContent, 'utf8'));
                vscode.window.showInformationMessage(`Successfully exported ${Object.keys(connections).length} connections to ${path.basename(uri.fsPath)}`);
            }
        } catch (error) {
            console.error('Export error:', error);
            vscode.window.showErrorMessage(`Failed to export connections: ${error.message}`);
        }
    }

    /**
     * Import connections from XML format
     */
    async importConnections(): Promise<void> {
        try {
            // Show open dialog
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'XML Files': ['xml']
                }
            });

            if (uris && uris.length > 0) {
                const uri = uris[0];
                const fileContent = await vscode.workspace.fs.readFile(uri);
                const xmlContent = Buffer.from(fileContent).toString('utf8');
                
                const connections = this.parseXML(xmlContent);
                
                if (Object.keys(connections).length === 0) {
                    vscode.window.showWarningMessage('No valid connections found in the XML file.');
                    return;
                }

                // Ask user for confirmation
                const choice = await vscode.window.showWarningMessage(
                    `Found ${Object.keys(connections).length} connections to import. This will overwrite existing connections with the same ID. Continue?`,
                    'Import', 'Cancel'
                );

                if (choice === 'Import') {
                    await this.mergeConnections(connections);
                    vscode.window.showInformationMessage(`Successfully imported ${Object.keys(connections).length} connections from ${path.basename(uri.fsPath)}`);
                    
                    // Refresh the view
                    vscode.commands.executeCommand('ssh.refresh');
                }
            }
        } catch (error) {
            console.error('Import error:', error);
            vscode.window.showErrorMessage(`Failed to import connections: ${error.message}`);
        }
    }

    /**
     * Generate XML content from connections
     */
    private generateXML(connections: { [key: string]: SSHConfig }): string {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<ssh-connections>\n';
        
        for (const [id, config] of Object.entries(connections)) {
            xml += '  <connection id="' + this.escapeXmlAttribute(id) + '">\n';
            xml += '    <name>' + this.escapeXmlContent(config.name || '') + '</name>\n';
            xml += '    <host>' + this.escapeXmlContent(config.host) + '</host>\n';
            xml += '    <port>' + config.port + '</port>\n';
            xml += '    <username>' + this.escapeXmlContent(config.username) + '</username>\n';
            
            if (config.password) {
                xml += '    <password encoding="base64">' + Buffer.from(config.password).toString('base64') + '</password>\n';
            }
            
            if (config.private) {
                xml += '    <private-key-path>' + this.escapeXmlContent(config.private) + '</private-key-path>\n';
            }
            
            if (config.passphrase) {
                xml += '    <passphrase encoding="base64">' + Buffer.from(config.passphrase).toString('base64') + '</passphrase>\n';
            }
            
            if (config.algorithms && config.algorithms.cipher && config.algorithms.cipher.length > 0) {
                xml += '    <algorithms>\n';
                xml += '      <cipher>\n';
                for (const cipher of config.algorithms.cipher) {
                    xml += '        <algorithm>' + this.escapeXmlContent(cipher) + '</algorithm>\n';
                }
                xml += '      </cipher>\n';
                xml += '    </algorithms>\n';
            }
            
            xml += '  </connection>\n';
        }
        
        xml += '</ssh-connections>';
        return xml;
    }

    /**
     * Parse XML content to connections
     */
    private parseXML(xmlContent: string): { [key: string]: SSHConfig } {
        const connections: { [key: string]: SSHConfig } = {};
        
        try {
            // Simple XML parsing using regex (for basic XML structure)
            const connectionMatches = xmlContent.match(/<connection[^>]*>([\s\S]*?)<\/connection>/g);
            
            if (connectionMatches) {
                for (const connectionMatch of connectionMatches) {
                    const idMatch = connectionMatch.match(/id="([^"]*)"/);
                    if (!idMatch) continue;
                    
                    const id = idMatch[1];
                    const config: SSHConfig = {
                        host: '',
                        port: 22,
                        username: ''
                    };
                    
                    // Extract basic properties
                    const nameMatch = connectionMatch.match(/<name>([^<]*)<\/name>/);
                    if (nameMatch) config.name = nameMatch[1];
                    
                    const hostMatch = connectionMatch.match(/<host>([^<]*)<\/host>/);
                    if (hostMatch) config.host = hostMatch[1];
                    
                    const portMatch = connectionMatch.match(/<port>([^<]*)<\/port>/);
                    if (portMatch) config.port = parseInt(portMatch[1]) || 22;
                    
                    const usernameMatch = connectionMatch.match(/<username>([^<]*)<\/username>/);
                    if (usernameMatch) config.username = usernameMatch[1];
                    
                    // Extract password (base64 decoded)
                    const passwordMatch = connectionMatch.match(/<password[^>]*>([^<]*)<\/password>/);
                    if (passwordMatch) {
                        try {
                            config.password = Buffer.from(passwordMatch[1], 'base64').toString('utf8');
                        } catch (e) {
                            console.warn('Failed to decode password for connection:', id);
                        }
                    }
                    
                    // Extract private key path
                    const privateKeyMatch = connectionMatch.match(/<private-key-path>([^<]*)<\/private-key-path>/);
                    if (privateKeyMatch) config.private = privateKeyMatch[1];
                    
                    // Extract passphrase (base64 decoded)
                    const passphraseMatch = connectionMatch.match(/<passphrase[^>]*>([^<]*)<\/passphrase>/);
                    if (passphraseMatch) {
                        try {
                            config.passphrase = Buffer.from(passphraseMatch[1], 'base64').toString('utf8');
                        } catch (e) {
                            console.warn('Failed to decode passphrase for connection:', id);
                        }
                    }
                    
                    // Extract algorithms
                    const algorithmsMatch = connectionMatch.match(/<algorithms>([\s\S]*?)<\/algorithms>/);
                    if (algorithmsMatch) {
                        const cipherMatches = algorithmsMatch[1].match(/<algorithm>([^<]*)<\/algorithm>/g);
                        if (cipherMatches) {
                            config.algorithms = { cipher: [] };
                            for (const cipherMatch of cipherMatches) {
                                const cipherValue = cipherMatch.match(/<algorithm>([^<]*)<\/algorithm>/);
                                if (cipherValue) {
                                    config.algorithms.cipher.push(cipherValue[1]);
                                }
                            }
                        }
                    }
                    
                    // Validate required fields
                    if (config.host && config.username) {
                        connections[id] = config;
                    } else {
                        console.warn('Skipping connection with missing required fields:', id);
                    }
                }
            }
        } catch (error) {
            console.error('XML parsing error:', error);
            throw new Error('Invalid XML format');
        }
        
        return connections;
    }

    /**
     * Merge imported connections with existing ones
     */
    private async mergeConnections(newConnections: { [key: string]: SSHConfig }): Promise<void> {
        const existingConnections = this.getConnections();
        const mergedConnections = { ...existingConnections, ...newConnections };
        
        await this.context.globalState.update(CacheKey.CONECTIONS_CONFIG, mergedConnections);
    }

    /**
     * Get current connections from storage
     */
    private getConnections(): { [key: string]: SSHConfig } {
        return this.context.globalState.get<{ [key: string]: SSHConfig }>(CacheKey.CONECTIONS_CONFIG) || {};
    }

    /**
     * Escape XML attribute values
     */
    private escapeXmlAttribute(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Escape XML content
     */
    private escapeXmlContent(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}
