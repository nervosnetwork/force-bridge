const SnakeNamingStrategy = require('typeorm-naming-strategies').SnakeNamingStrategy;

module.exports = {
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  username: 'root',
  password: 'root',
  database: 'forcebridge',
  timezone: 'Z',
  synchronize: true,
  logging: false,
  entities: ['packages/x/dist/db/entity/*.js'],
  namingStrategy: new SnakeNamingStrategy(),
};
