#!/usr/bin/env node
import fs from "node:fs/promises";
import LicenseServer from "./LicenseServer.js";
import Proxy from "./Proxy.js";
import ServerManager from "./ServerManager.js";

process.env.NODE_ENV = "production";

const args = process.argv.slice(2);
const label = process.argv[1];
const info = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

if (args.length === 0) {
	help();
	process.exit(0);
}

interface Options {
	command: [(a?: string) => any, string | undefined] | Function,
	format: number,
	available: boolean,
	online: boolean,
	newline: boolean,
	proxyServers?: string,
	proxyTokens: string
}

const options: Partial<Options> = {
	format: 2
};

for (let i = 0; i < args.length; ++i) {
	const arg = args[i]!;
	//const value = args[i + 1]?.startsWith("-") ? void 0 : args[i + 1];
	let  _v: boolean = false;
	function value(): string | undefined {
		if (!_v) {
			if (args[i + 1]?.startsWith("-") && args[i + 1] !== "-") return void 0;
			++i;
			_v = true;
		}
		return args[i];
	}
	if (["-c", "--check"].includes(arg)) options.command = [check, value()];
	else if (["-a", "--all"].includes(arg)) options.command = [all, value()];
	else if (["--available"].includes(arg)) options.available = true;
	else if (["--online"].includes(arg)) options.online = true;
	else if (["--newline"].includes(arg)) options.newline = true;
	else if (["-p", "--proxy"].includes(arg)) options.command = [proxy, value()];
	else if (["--servers"].includes(arg)) options.proxyServers = value();
	else if (["--tokens"].includes(arg)) {
		if (value() === undefined) missingValue("--tokens <file>");
		options.proxyTokens = value();
	}
	else if (["-v", "--version"].includes(arg)) options.command = version;
	else if (["-f", "--format"].includes(arg)) {
		if (!value) missingValue("--format <number>");
		options.format = Number(value);
	}
	else if (["-h", "--help"].includes(arg)) options.command = help;
	else unexpectedArgument(arg);
}

if (options.command) {
	if (typeof options.command === "function") options.command();
	else options.command[0](options.command[1]);
}
else help();

async function check (url?: string) {
	if (!url) return missingValue("--check <url>");
	const server = new LicenseServer(new URL(url));
	await server.check();
	json(server.json());
}

async function all(file?: string) {
	let data;
	try {
		data = (!file || file === "-" ? await readStdin() : await fs.readFile(file)).toString().trim()
	}
	catch (e: any) {
		return console.error("error:", e.message);
	}
	if (data === "") return json([]);
	let servers = data.split("\n").map(line => new LicenseServer(new URL(line.trim())));
	await Promise.all(servers.map(server => server.check()));
	if (options.available)
		servers = servers.filter(server => server.available);
	if (options.online)
		servers = servers.filter(server => server.online);
	if (options.newline) return console.log(servers.map(s => s.url.href).join("\n"));
	else json(servers.map(server => server.json()));
}

async function proxy(port?: string) {
	let nPort = Number(port);
	if (Number.isNaN(nPort)) nPort = 8080;

	let tokens: string[] = [];
	if (options.proxyTokens) try {
		tokens = (await fs.readFile(options.proxyTokens, "utf8")).trim().split("\n");
	}
	catch (e: any) {
		return console.error("error:", e.message);
	}

	if (options.proxyServers === undefined) return missingArgument("--servers");
	let servers: LicenseServer[] = [];
	try {
		const d = (!options.proxyServers || options.proxyServers === "-" ? await readStdin() : await fs.readFile(options.proxyServers, "utf8")).toString().trim();
		if (!d) {
			console.error("error: no servers were provided");
			process.exit(1);
		}
		servers = d.split("\n").map(line => new LicenseServer(new URL(line.trim())));
	}
	catch (e: any) {
		return console.error("error:", e.message);
	}
	if (servers.length === 0) {
		console.error("error: no servers were provided");
		process.exit(1);
	}

	const proxyServer = new Proxy(nPort, tokens, new ServerManager(servers));
	try {
		proxyServer.start().then();
	}
	catch (e: any) {
		return console.error("error:", e.message);
	}
	process.on("SIGINT", async () => {
		await proxyServer.stop();
		console.log("\nGoodbye!");
	});
}

function version () {
	console.log(info.version);
}

function help () {
	console.log(`A command line tool for detecting JetBrains license servers.

Usage:	${label} [options]

Options:
  -c, --check <url>
          Check a license server. Outputs JSON.
  -a, --check-all [file]
          Check a list of license servers (separated by new line). Outputs JSON.
          Use '-' for standard input.
      --available
          When using --check-all, output only available servers
      --online
          When using --check-all, output only online servers
      --newline
          When using --check-all, output only server URLs separated by new line
  -p, --proxy [port]
          Create an HTTP proxy that uses the fastest available license server.
          The default port is 8080.
      --servers [file]
          List of license servers (separated by new line) for the proxy to check
          and use. This is required when using --proxy.
          Use '-' for standard input.
      --tokens <file>
          List of access tokens used for accessing the proxy (separated by new
          line). If set, to use the server you need to add a token in the path
          when adding it in your IDE, like so:
              http://localhost:8080/<token>
  -v, --version
          Print version
  -f, --format <number>
          Format JSON output spaces (default: 2)
  -h, --help
          Print help`);
}

// cli utilities
function json(data: any) {
	console.log(JSON.stringify(data, null, options.format));
}

function missingValue(argument: string) {
	console.error(`error: a value is required for '${argument}' but none was supplied

For more information, try '--help'.`)
	process.exit(1);
}

function missingArgument(argument: string) {
	console.error(`error: argument '${argument}' is required but was not supplied

For more information, try '--help'.`)
	process.exit(1);
}

function unexpectedArgument(argument: string) {
	console.error(`error: unexpected argument '${argument}' found`);
	process.exit(1);
}

function readStdin(): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let data: Buffer[] = [];
		process.stdin.on("data", (chunk) => {
			data.push(chunk);
		});
		process.stdin.on("end", () => {
			resolve(Buffer.concat(data));
		});
		process.stdin.on("error", (err) => {
			reject(err);
		});
	});
}