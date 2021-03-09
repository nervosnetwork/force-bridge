const SnakeNamingStrategy = require('typeorm-naming-strategies').SnakeNamingStrategy;

module.exports = {
  type: 'sqlite',
  database: 'force-bridge.sqlite',
  synchronize: true,
  logging: true,
  entities: ['src/packages/db/entity/**/*.ts'],
  migrations: ['src/packages/db/migration/**/*.ts'],
  subscribers: ['src/packages/db/subscriber/**/*.ts'],
  cli: {
    entitiesDir: 'src/packages/db/entity',
    migrationsDir: 'src/packages/db/migration',
    subscribersDir: 'src/packages/db/subscriber',
  },
  namingStrategy: new SnakeNamingStrategy(),
};
