process.env.DEBUG = "cobalt-debug"
const { CobaltClient } = require("./CobaltClient")

    ;
(async () => {
    const realmInstance = new CobaltClient({
        "realms": {
            "realmInvite": "sG7N8-u5xLc"
        },
        // "host": "127.0.0.1",
        // port: 19132,
        "skinData": {
            "ClientRandomId": Date.now() ** Math.random(),
            "DeviceId": crypto.randomUUID(),
            "DeviceModel": "ps_emu",
            "DeviceOS": 11,
            "SkinId": btoa(crypto.randomUUID()),
            "SelfSignedId": -(Date.now() / 2 / Math.random()),
        },
        "username": "1",
        conLog: () => { }
    });

})();

