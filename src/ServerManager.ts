import LicenseServer from "./LicenseServer.js";

export default class ServerManager {
    public constructor(public readonly servers: LicenseServer[]) {}
    #lastChecked: Date | null = null;
    public lastChecked(): Date | null {
        return this.#lastChecked;
    }

    public static INTERVAL_DELAY = 6e5;
    private readonly interval = setInterval(() => this.check().then(), ServerManager.INTERVAL_DELAY);

    public async check() {
        this.#lastChecked = new Date();
        await Promise.all(this.servers.map(server => server.check()));
    }

    /**
     * Get servers that are available, sorted by last ping (ascending)
     */
    public available() {
        return this.servers.filter(server => server.available).sort((a, b) => a.lastPing - b.lastPing);
    }

    /**
     * Get all servers, sorted by last ping (ascending)
     */
    public all() {
        return this.servers.sort((a, b) => a.lastPing - b.lastPing);
    }

    /**
     * Available server with lowest ping
     */
    public best(): LicenseServer | null {
        const available = this.available();
        return available.length > 0 ? available[0]! : null;
    }

    public stop() {
        clearInterval(this.interval);
    }
}
