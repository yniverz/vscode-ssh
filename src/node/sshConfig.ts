export interface SSHConfig {
    /**
     * connection name
     */
    name?: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    /**
     * private key path
     */
    private?: string;
    /**
     * private key buffer
     */
    privateKey?: Buffer;
    passphrase?: string;
    algorithms?: Algorithms;
}

export interface Algorithms {
    cipher?: string[];
}

export function getSshConfigIdentifier(config: SSHConfig): string {
    return `${config.name}_${config.username}_${config.host}_${config.port}`;
}