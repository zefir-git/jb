import * as http from "node:http";
import Stream from "node:stream";
import {parseString} from "xml2js";
import * as child_process from "child_process";

/**
 * A (potential) JetBrains license server
 */
export default class LicenseServer {
    private static async path(): Promise<string> {
        return "rpc/obtainTicket.action?machineId=bd212404-223e-47af-9735-a09ba863550e&productFamilyId=49c202d4-ac56-452b-bb84-735056242fb3&salt=1709279583227&userName="
            + await LicenseServer.getWord()
            + "&hostName="
            + await LicenseServer.getWord();
    }
    private static getWord(): Promise<string> {
        return new Promise(resolve => {
            const cp = child_process.spawn("sh", [
                "-c",
                `awk "NR==$(od -N3 -An -i /dev/urandom | awk -v f=0 -v r="$(cat /usr/share/dict/words | wc -l)" '{printf "%i\\n", f + r * $1 / 16777216}')" /usr/share/dict/words`
            ]);
            cp.stdout.on("data", data => resolve(data.toString().trim()));
            const fallback = crypto.randomUUID().split("-")[0]!;
            cp.on("error", () => resolve(fallback));
            cp.on("exit", code => {
                if (code !== 0) resolve(fallback);
            });
            cp.stderr.on("data", () => resolve(fallback));
        });
    }
    public constructor(public readonly url: URL) {}

    #online: boolean = false;
    /**
     * Whether this server is online.
     * If the server is offline, it is very unlikely it will be available soon.
     * This is always false if {@link check} has not been called.
     */
    public get online(): boolean {
        return this.#online;
    }

    #lastPing: number = 9e5;
    /**
     * The time in ms it took to connect to this server last time it was checked.
     * A very large number (9e5) if this server has not been detected online or never {@link check}ed.
     */
    public get lastPing(): number {
        return this.#lastPing;
    }

    #lastStatus: string = "not checked";
    public get lastStatus(): string {
        return this.#lastStatus;
    }

    #available: boolean = false;
    /**
     * Whether this server is ready for license requests.
     * Chances are you will be able to obtain a license from this server if this is true.
     */
    public get available(): boolean {
        return this.#online && this.#available;
    }
    
    #lastChecked: Date | null = null;
    /**
     * The time this server was last checked.
     * Null if it has not been checked yet.
     */
    public get lastChecked(): Date | null {
        return this.#lastChecked;
    }

    private set available(available: boolean) {
        this.#available = available;
        this.#lastChecked = new Date();
    }

    /**
     * Send a request to check the state of this server.
     */
    public async check(): Promise<void> {
        const start = Date.now();
        try {
            const response = await fetch(this.url.href + await LicenseServer.path());
            this.#online = response.ok;
            this.#lastPing = Date.now() - start;
            this.#lastStatus = "connected";
            this.available = await this.isAvailable(await response.text());
        }
        catch (e) {
            if (e instanceof Error)
                this.#lastStatus = "connection error: " + e.message;
            else this.#lastStatus = "connection error: " + e;
            this.#online = false;
        }
    }

    /**
     * Proxy a request through this server.
     */
    public async proxy(req: http.IncomingMessage & {url: void}, res: http.ServerResponse, url: string): Promise<void> {
        try {
            const isObtainTicketRequest = LicenseServer.isObtainTicketRequest(url);
            const start = Date.now();
            const proxyReq = http.request({
                host: this.url.hostname,
                port: this.url.port,
                path: url,
                method: req.method
            }, async proxyRes => {
                this.#online = true;
                res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
                if (isObtainTicketRequest) {
                    this.#lastPing = Date.now() - start;
                    const response = await LicenseServer.readStream(proxyRes);
                    res.end(response);
                    this.available = await this.isAvailable(response.toString());
                }
                else proxyRes.pipe(res);
            });
            req.on("data", chunk => proxyReq.write(chunk));
            req.on("end", () => proxyReq.end());
            req.on("error", e => {
                proxyReq.destroy();
                res.writeHead(500, {"content-type": "text/plain"});
                res.end("Server error");
                console.error(e);
            });
        }
        catch (e) {
            res.writeHead(500, {"content-type": "text/plain"});
            res.end("Server error");
            console.error(e);
            this.#online = false;
        }
    }

    public json() {
        return {url: this.url.href, online: this.online, available: this.available, ping: this.online ? this.lastPing : null, status: this.lastStatus};
    }

    private static parseXML(xml: string): Promise<any> {
        return new Promise((resolve, reject) => {
            parseString(xml, (err, result) => {
                if (err) reject(err);
                resolve(result);
            });
        });
    }

    /**
     * Get data from stream
     */
    private static readStream(stream: Stream.Readable): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on("data", chunk => chunks.push(chunk));
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", reject);
        });
    }

    /**
     * Determine if licenses are available on this server based on the response of `obtainTicket.action`
     */
    public async isAvailable(response: string) {
        try {
            const data = await LicenseServer.parseXML(response);
            const status = Boolean(data && "ObtainTicketResponse" in data && "responseCode" in (data as { ObtainTicketResponse: any }).ObtainTicketResponse && (data as { ObtainTicketResponse: { responseCode: any } }).ObtainTicketResponse.responseCode.length > 0 && (data as { ObtainTicketResponse: { responseCode: any } }).ObtainTicketResponse.responseCode[0] === "OK");
            if (data && "ObtainTicketResponse" in data && "message" in (data as { ObtainTicketResponse: any }).ObtainTicketResponse && (data as { ObtainTicketResponse: { message: any } }).ObtainTicketResponse.message.length > 0)
                if (data.ObtainTicketResponse.message[0]) this.#lastStatus = "JB: " + data.ObtainTicketResponse.message[0];
                else this.#lastStatus = "OK";
            else this.#lastStatus = "unknown";
            return status;
        }
        catch (e) {
            if (e instanceof Error) this.#lastStatus = "error: " + e.message;
            else this.#lastStatus = "error";
            return false;
        }
    }

    /**
     * Check if a request is an `obtainTicket.action` request
     */
    public static isObtainTicketRequest(req: string): boolean {
        return req.includes("/rpc/obtainTicket.action");
    }
}
