import * as http from "http";
import ServerManager from "./ServerManager";

export default class Proxy {
    private readonly server = http.createServer(this.handler.bind(this));
    public constructor(private readonly port: number = 80, private readonly tokens: string[], private readonly servers: ServerManager) {
        console.log("Registered " + this.tokens.length + " token" + (this.tokens.length === 1 ? "" : "s"));
    }

    public async start() {
        await this.servers.check();
        this.server.on("error", err => {
           console.error("error: " + err.message);
           process.exit(1);
        });
        this.server.listen(this.port, () => console.log(`Listening on port ${this.port}`));
    }

    public stop(): Promise<void> {
        return new Promise(resolve => {
            this.servers.stop();
            this.server.close(() => resolve());
        });
    }

    private async handler(req: http.IncomingMessage, res: http.ServerResponse) {
        if (req.url === "/") {
            res.writeHead(204)
            res.end();
            return;
        }

        if (req.url === "/servers/available.json") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(this.servers.available().map(s => s.json())));
            return;
        }

        if (req.url === "/servers/available.txt") {
            res.setHeader("content-type", "text/plain");
            res.end(this.servers.available().map(s => s.url.href).join("\n"));
            return;
        }

        if (req.url === "/servers/all.json") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(this.servers.all().map(s => s.json())));
            return;
        }

        if (req.url === "/servers/all.txt") {
            res.setHeader("content-type", "text/plain");
            res.end(this.servers.all().map(s => s.url.href).join("\n"));
            return;
        }

        const originalUrl = req.url;
        if (!originalUrl) {
            res.writeHead(404, {"content-type": "text/plain"});
            res.end("Not found");
            return;
        }

        const token = originalUrl.split("/")[1];
        if (this.tokens.length > 0 && (!token || !this.tokens.includes(token))) {
            res.writeHead(404, {"content-type": "text/plain"});
            res.end("Not found");
            return;
        }

        const best = this.servers.best();
        if (!best) {
            res.writeHead(503, {
                "content-type": "text/plain",
                "retry-after": (this.servers.lastChecked() ? Math.round((Date.now() - this.servers.lastChecked()!.getTime() + ServerManager.INTERVAL_DELAY)/1000) : 0).toString()
            });
            res.end("No servers available");
            return;
        }

        await best.proxy(req as any, res, this.tokens.length > 0 && token ? originalUrl.slice(token.length + 1) : originalUrl);
    }
}
