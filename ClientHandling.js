const { Client } = require("bedrock-protocol/src/client");
const { RakClient } = require("bedrock-protocol/src/rak")("raknet-native");
const { Authflow: PrismarineAuth, Titles } = require("prismarine-auth");
const { RealmAPI } = require("prismarine-realms");
const assert = require("node:assert");
const path = require("node:path");
const advertisement = require("bedrock-protocol/src/server/advertisement");
const authflowCache = {};
const debug = require("debug")("cobalt-debug");

/** @param {import("bedrock-protocol/index").ClientOptions} options */
async function realmAuthenticate(options) {
	if (!options.profilesFolder) {
		options.profilesFolder = path.join(__dirname, "accounts");
	}
	if (options.authTitle === undefined) {
		options.authTitle = Titles.MinecraftNintendoSwitch;
		options.deviceType = "Nintendo";
		options.flow = "live";
	}
	authflowCache[options.profilesFolder] ??= {};
	authflowCache[options.profilesFolder][options.username] ??= new PrismarineAuth(options.username, options.profilesFolder, options, options.onMsaCode);
	options.authflow ??= authflowCache[options.profilesFolder][options.username];

	const api = RealmAPI.from(options.authflow, "bedrock");

	const getRealms = async () => {
		const realms = await api.getRealms();
		console.debug("realms", realms);
		if (!realms.length)
			throw Error("Couldn't find any Realms for the authenticated account");
		return realms;
	};
	/** @type {import("prismarine-realms/index").Realm} */
	let realm;

	if (options.realms.realmId) {
		const realms = await getRealms();
		realm = realms.find((e) => e.id === Number(options.realms.realmId));
	} else if (options.realms.realmInvite) {
		realm = await api.getRealmFromInvite(options.realms.realmInvite);
	} else if (options.realms.pickRealm) {
		if (typeof options.realms.pickRealm !== "function")
			throw Error("realms.pickRealm must be a function");
		const realms = await getRealms();
		realm = await options.realms.pickRealm(realms);
	}

	if (!realm)
		throw Error(
			"Couldn't find a Realm to connect to. Authenticated account must be the owner or has been invited to the Realm.",
		);

	const { host, port } = await realm.getAddress();

	debug(`Connecting to realm '${realm.name}' (${realm.id}) at ${host}:${port}`);

	options.host = host;
	options.port = port;
}

/**
 * @param {import("bedrock-protocol/index").ClientOptions} options
 * @returns {import("bedrock-protocol/index").Client}
 */
function createClient(options) {
	assert(options);
	const client = new Client({
		port: 19132,
		followPort: !options.realms,
		...options,
		delayedInit: true,
	});

	client.onServerInfo = () => {
		client.on("connect_allowed", () => connect(client));
		if (options.skipPing) {
			client.init();
		} else {
			ping(client.options)
				.then((ad) => {
					if (ad.portV4 && client.options.followPort) {
						client.options.port = ad.portV4;
					}
					client.conLog?.(`Connecting to ${client.options.host}:${client.options.port} ${ad.motd} (${ad.levelName}), version ${ad.version} ${client.options.version !== ad.version ? ` (as ${client.options.version})` : ""}`);
					client.init();
				})
				.catch((e) => client.emit("error", e));
		}
	};

	if (options.realms) {
		const findAddress = async () => {
			realmAuthenticate(client.options)
				.then(client.onServerInfo)
				.catch(async (e) => {
					await new Promise((r) => setTimeout(r, 5000));
					findAddress();
				});
		};
		findAddress();
	} else {
		client.onServerInfo();
	}
	return client;
}
function connect(client) {
	client.connect();

	client.once("resource_packs_info", (packet) => {
		client.write("resource_pack_client_response", {
			response_status: "completed",
			resourcepackids: [],
		});

		client.once("resource_pack_stack", (stack) => {
			client.write("resource_pack_client_response", {
				response_status: "completed",
				resourcepackids: [],
			});
		});

		client.queue("client_cache_status", { enabled: false });
		client.queue("tick_sync", {
			request_time: BigInt(Date.now()),
			response_time: 0n,
		});
		new Promise((r) => setTimeout(r, 500)).then(() =>
			client.queue("request_chunk_radius", {
				chunk_radius: client.viewDistance || 10,
			}),
		);
	});

	// Send tick sync packets every 10 ticks
	const keepAliveInterval = 10;
	const keepAliveIntervalBig = BigInt(keepAliveInterval);
	/** @type {NodeJS.Timeout} */
	let keepalive;

	client.tick = 0n;
	client.once("spawn", () => {
		keepalive = setInterval(() => {
			client.queue("tick_sync", {
				request_time: client.tick,
				response_time: 0n,
			});
			client.tick += keepAliveIntervalBig;
		}, 50 * keepAliveInterval);

		client.on("tick_sync", async (packet) => {
			client.emit("heartbeat", packet.response_time);
			client.tick = packet.response_time;
		});
	});

	client.once("close", () => {
		clearInterval(keepalive);
	});
}

async function ping({ host, port }) {
	const con = new RakClient({ host, port });
	try {
		return advertisement.fromServerName(await con.ping());
	} finally {
		con.close();
	}
}

module.exports = { createClient, ping };
