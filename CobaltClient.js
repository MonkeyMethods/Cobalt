process.env.DEBUG = "cobalt";
const debug = require("debug")("cobalt-debug");
const release = require("debug")("cobalt-release")
release("Starting Cobalt...");
debug("Debugging enabled!");
const protocol = require("./clientHandling");
const { KeyExchange } = require('bedrock-protocol/src/handshake/keyExchange')
const Login = require('bedrock-protocol/src/handshake/login')
const LoginVerify = require('bedrock-protocol/src/handshake/loginVerify')
const { defaultOptions } = require("bedrock-protocol/src/options.js")

const DefaultSkinData = require("./skindata.json")
const assert = require("node:assert");
require("./defs");
const { EventEmitter } = require("node:events");
const { parse } = require("node:path");
const { createClient } = require("bedrock-protocol");
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
				...(ClientOptions.skinData ?? {})
			}
		};
		this.client = protocol.createClient(this.options);
		debug("Registering listeners...");
		this.RegisterListeners();
		debug("Listeners registered!");
		release(`Cobalt was initialized for ${this.options.realms?.realmInvite ?? `${this.options.host}:${this.options.port}`}!`);
		debug(`Cobalt was initialized for ${this.options.realms?.realmInvite ?? `${this.options.host}:${this.options.port}`}!`);
	}

	RegisterListeners() {
		const client = this.client;
		debug("Connecting to realm...");
		client.on("play_status", async ({ status }) => {
			if (status !== "login_success") return;
			debug("Successfully logged in!");
			release(`Connected to ${client.options.realms?.realmInvite ?? `${client.options.host}:${client.options.port}`} with ${client.profile.name}`);
		});
		client.on("disconnect", async ({ reason, message }) => {
			if (client.lastDisconnected && Date.now() - client.lastDisconnected < 5000) return;
			client.lastDisconnected = Date.now();
			release(`The client was disconnected: ${reason} - ${message}\nSince this was unexpected, the client will now reconnect...`);
			debug(`The client was disconnected: ${reason} - ${message}\nSince this was unexpected, the client will now reconnect...`);
			await new Promise((r) => setTimeout(r, 5000));
			this.reconnect();
		});

		client.on("play_status", async ({ status }) => {
			if (status !== "login_success") return;
			await new Promise((resolve) => setTimeout(resolve, 11));
			release(`Connected to ${client.options.realms?.realmInvite ?? `${client.options.host}:${client.options.port}`} with ${client.profile.name}`)
			client.write("text", {
				needs_translation: true,
				"platform_chat_id": "",
				"xuid": "",
				"type": "chat",
				"message": [
					``,
					`§7§l${"-".repeat(12)}`,
					`§r§d» §rHello, I'm a bot known as §d§lCobalt§r§d.`,
					`§r§d» §rIf you're seeing this message, it means that your realm is currently being used for beta testing.`,
					`§r§d» §rPlease be patient as we work to improve the bot and make it more stable.`,
					`§r§d» §rIf you have any questions or concerns, please contact §b§ltrippleawap§r on Discord.`,
					``
				].join("\n"),
				"source_name": "",
			});
			// can run extra stuff here
		})
		this.RegisterChecks();
	}

	RegisterChecks() {
		const client = this.client;
		client.on("player_list", async ({ records: { records: players, type } }) => {
			if (type !== "add") return;
			for (const player of players ?? []) {
				if (this.#players[player.username]?.passed) continue; // .filter then loop would be slower because well, it'd be 2 loops
				if (!player.username) {
					// this should never occur with the type check so prob flag the user here!
					debug("Player has no username, skipping...", player);
					continue;
				}
				if (player.username === client.profile.name) continue;
				// dont know actual username length cap but 16 should be fine
				if (player.username.length > 16) {
					debug(`${player.username.substring(0, 16)}'s username is too long, total length: ${player.username.length}!`);
					client.write("command_request", {
						// ehh to lazy you do this
					})
					this.#players[player.username] = { ...player, passed: false, failedCheck: 0xFF };
					continue;
				}
				const result = await CobaltClient.VerifySkinData(player.skin_data);
				if (result === 0) {
					debug(`${player.username} passed all checks!`);
					this.#players[player.username] = { ...player, passed: true };
					continue;
				}
				release(`${player.username.substring(0, 16)} failed the check`, `0x${result.toString(16)}`);
				debug(`${player.username.substring(0, 16)} failed the check`, `0x${result.toString(16)}`);
				client.write("command_request", {
					// ehh to lazy you do this
				})
				this.#players[player.username] = { ...player, passed: false, failedCheck: result };
			}
		});
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
	 *  @returns {Number} returns 0 if the skin data is valid else returns the index of the failed check.
	 */
	static VerifySkinData(skinData) {
		try {
			try {
				if (Buffer.from(skinData.skin_data.data, "base64").at(0) === undefined) throw ''
			} catch (e) {
				throw new Error("Invalid skin data! 0");
			}
			try {
				if (Buffer.from(skinData.cape_data.data, "base64").at(0) === undefined) throw ''
			} catch (e) {
				throw new Error("Invalid cape data! 1");
			}
			try {
				if (skinData.geometry_data.length < 1) throw new Error("Invalid geometry data! 3");
			} catch (e) {
				throw new Error("Invalid geometry data! 3");
			}
			try {
				if (skinData.skin_id === "") throw new Error("Invalid skin id! 5");
			} catch (e) {
				throw new Error("Invalid skin id! 5");
			}
			try {
				if (skinData.geometry_data_version === "") throw new Error(`Invalid geometry id "${skinData.geometry_data_version}"! 6`);
			} catch (e) {
				throw new Error("Invalid geometry id! 6");
			}
			try {
				if (typeof skinData.animations !== "object") throw new Error("Invalid animations! 7");
			} catch (e) {
				throw new Error("Invalid animations! 7");
			}
			try {
				if (skinData.full_skin_id === "") throw new Error("Invalid full skin id! 8");
			} catch (e) {
				throw new Error("Invalid full skin id! 8");
			}
			try {
				JSON.parse(skinData.skin_resource_pack);
			} catch (e) {
				throw new Error("Invalid skin resource pack! 9");
			}
		} catch (e) {
			const checkN = e.message.split("!")[1].trim();
			debug(e.message.split("!")[0] + "!", `0x${(parseInt(checkN) + 1).toString(16)}`);
			return (parseInt(checkN) + 1);
		}
		return 0;
	}
}
module.exports = { CobaltClient };
