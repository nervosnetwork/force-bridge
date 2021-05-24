import { Indexer } from '@ckb-lumos/sql-indexer';
import Knex from 'knex';
import nconf from 'nconf';
const configPath = './config.json';
nconf.env().file({ file: configPath });
const CKB_URL = nconf.get('forceBridge:ckb:ckbRpcUrl');
const LumosDBHost = nconf.get('forceBridge:lumosDBConfig:host');
const LumosDBName = nconf.get('forceBridge:lumosDBConfig:database');
const LumosDBPort = nconf.get('forceBridge:lumosDBConfig:port');
const LumosDBUser = nconf.get('forceBridge:lumosDBConfig:user');
const LumosDBPassword = nconf.get('forceBridge:lumosDBConfig:password');
import fs from 'fs';
import shell from 'shelljs';

const knex = Knex({
  client: 'mysql2',
  connection: {
    host: LumosDBHost,
    database: LumosDBName,
    user: LumosDBUser,
    password: LumosDBPassword,
    port: LumosDBPort,
  },
});

const knexContext = `module.exports = {
    development: {
        client: 'mysql2',
        connection: {
            host: '${LumosDBHost}',
            database: '${LumosDBName}',
            user: '${LumosDBUser}',
            password: '${LumosDBPassword}',
            port: '${LumosDBPort}',
        },
        pool: {
            min: 2,
            max: 10
        },
        migrations: {
            tableName: 'knex_migrations'
        }
    }
};`;

const main = async () => {
  await fs.writeFileSync('node_modules/@ckb-lumos/sql-indexer/knexfile.js', knexContext);
  shell.exec(`cd node_modules/@ckb-lumos/sql-indexer/ && npx knex migrate:up`);
};

main()
  .then(() => {
    const sqlIndexer = new Indexer(CKB_URL, knex);
    sqlIndexer.startForever();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
