process.env.DEBUG = "cobalt";
const debug = require("debug")("cobalt-debug");
const release = require("debug")("cobalt-release");
release("Starting Cobalt...");
debug("Debugging enabled!");
const protocol = require("./clientHandling");
const { defaultOptions } = require("bedrock-protocol/src/options.js");

const DefaultSkinData = require("./skindata.json");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
class CobaltClient extends EventEmitter {
	#players = {};
	/** @type {import("bedrock-protocol/index").Client} */
	client;

	/** @type {import("bedrock-protocol/index").ClientOptions} */
	options;
	/**
	 * @param {import("bedrock-protocol").ClientOptions && { SkinData: typeof DefaultSkinData }} ClientOptions
	 */
	constructor(ClientOptions) {
		super();
		this.options = {
			...defaultOptions,
			viewDistance: 9e20,
			...ClientOptions,
			// these should never be changed as these are the quickest options
			raknetBackend: "raknet-native",
			useRaknetWorker: true,
			skinData: {
				...DefaultSkinData,
				...(ClientOptions.skinData ?? {}),
			},
		};
		this.client = protocol.createClient(this.options);
		debug("Registering listeners...");
		this.RegisterListeners();
		debug("Listeners registered!");
		release(
			`Cobalt was initialized for ${this.options.realms?.realmInvite ?? `${this.options.host}:${this.options.port}`}!`,
		);
		debug(
			`Cobalt was initialized for ${this.options.realms?.realmInvite ?? `${this.options.host}:${this.options.port}`}!`,
		);
	}

	RegisterListeners() {
		const client = this.client;
		debug("Connecting to realm...");
		client.on("play_status", async ({ status }) => {
			if (status !== "login_success") return;
			debug("Successfully logged in!");
			release(
				`Connected to ${client.options.realms?.realmInvite ?? `${client.options.host}:${client.options.port}`} with ${client.profile.name}`,
			);
		});
		client.on("disconnect", async ({ reason, message }) => {
			if (
				client.lastDisconnected &&
				Date.now() - client.lastDisconnected < 5000
			)
				return;
			client.lastDisconnected = Date.now();
			release(
				`The client was disconnected: ${reason} - ${message}\nSince this was unexpected, the client will now reconnect...`,
			);
			debug(
				`The client was disconnected: ${reason} - ${message}\nSince this was unexpected, the client will now reconnect...`,
			);
			await new Promise((r) => setTimeout(r, 5000));
			this.reconnect();
		});

		client.on("play_status", async ({ status }) => {
			if (status !== "login_success") return;
			await new Promise((resolve) => setTimeout(resolve, 11));
			release(
				`Connected to ${client.options.realms?.realmInvite ?? `${client.options.host}:${client.options.port}`} with ${client.profile.name}`,
			);
			client.write("text", {
				needs_translation: true,
				platform_chat_id: "",
				xuid: "",
				type: "chat",
				message: [
					"",
					`§7§l${"-".repeat(12)}`,
					`§r§d» §rHello, I'm a bot known as §d§lCobalt§r§d.`,
					`§r§d» §rIf you're seeing this message, it means that your realm is currently being used for beta testing.`,
					"§r§d» §rPlease be patient as we work to improve the bot and make it more stable.",
					"§r§d» §rIf you have any questions or concerns, please contact §b§ltrippleawap§r on Discord.",
					"",
				].join("\n"),
				source_name: "",
			});
			// can run extra stuff here
		});
		this.RegisterChecks();
	}

	RegisterChecks() {
		const client = this.client;
		client.on(
			"player_list",
			async ({ records: { records: players, type } }) => {
				if (type !== "add") return;
				for (const player of players ?? []) {
					if (this.#players[player.username]?.passed) continue; // .filter then loop would be slower because well, it'd be 2 loops
					if (!player.username) {
						// this should never occur with the type check so prob flag the user here!
						debug("Player has no username, BANNING!", player);
						// use realm api to ban the xuid from the realm maybe.. ( this could be abused prob dont but idk how you should handle this );
						continue;
					}
					if (player.username === client.profile.name) continue;
					// dont know actual username length cap but 16 should be fine
					if (player.username.length > 16) {
						debug(
							`${player.username.substring(0, 16)}'s username is too long, total length: ${player.username.length}!`,
						);
						client.write("command_request", {
							command: `kick "${player.username}" umm you failed a check!`,
							internal: true,
							version: 66,
							origin: {
								type: 0,
								uuid: "",
								request_id: "",
							},
						});
						this.#players[player.username] = {
							...player,
							passed: false
						};
						continue;
					}
					const result = await CobaltClient.VerifySkinData(player.skin_data);
					if (result) {
						debug(`${player.username} passed all checks!`);
						this.#players[player.username] = { ...player, passed: true };
						continue;
					}
					release(`${player.username.substring(0, 16)} failed a check!`);
					debug(`${player.username.substring(0, 16)} failed a check!`);
					// havent tested this but im 99% this is correct..
					client.write("command_request", {
						command: `kick "${player.username}" umm you failed a check!`,
						internal: true,
						version: 66,
						origin: {
							type: 0,
							uuid: "",
							request_id: "",
						},
					});
					this.#players[player.username] = {
						...player,
						passed: false
					};
				}
			},
		);
	}

	async close() {
		this.client.connection?.close();
		await new Promise((r) => setTimeout(r, 50));
		this.#players = {};
		return this;
	}

	async deleteClient() {
		await this.close();
		this.client = null;
		return this;
	}

	async reconnect() {
		assert(this.client.connection, "The client has not been initialized yet!");
		this.client.connection?.close();
		await new Promise((r) => setTimeout(r, 50));
		this.removeAllListeners();
		this.client.removeAllListeners();
		this.client = protocol.createClient(this.options);
		debug("Registering listeners...");
		this.RegisterListeners();
		debug("Listeners registered!");
	}

	get players() {
		return this.#players;
	}

	/**
	 *  @param {import("./types").Skin} skinData
	 *  @returns {boolean} returns 0 if the skin data is valid else returns the index of the failed check.
	 */
	static VerifySkinData(skinData) {
		try {
			if (Buffer.from(skinData.skin_data.data, "base64").at(0) === undefined)
				return false;
			Buffer.from(skinData.cape_data.data, "base64"); // this is usually empty so we dont check if 0 === undefined;
			if (skinData.geometry_data.length < 1) return false;
			if (throwskinData.skin_id === "")
				if (skinData.geometry_data_version === "") return false;
			if (typeof skinData.animations !== "object") return false;
			if (skinData.full_skin_id === "") return false;
			JSON.parse(skinData.skin_resource_pack);
			// handle stuff like failing to parse buffers ect.
		} catch (e) {
			return false;
		}
		return true;
	}
}
module.exports = { CobaltClient };
