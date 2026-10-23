const { MongoClient } = require('mongodb');

function createDatabase({ mongoUrl, dbName = 'giftdb', clientOptions = {} }) {
    const client = new MongoClient(mongoUrl, clientOptions);
    let connection;

    function connect() {
        if (!connection) {
            connection = client.connect().then(() => client.db(dbName)).catch((error) => {
                connection = undefined;
                throw error;
            });
        }
        return connection;
    }

    async function close() {
        await client.close();
        connection = undefined;
    }

    return { connect, close };
}

module.exports = { createDatabase };
