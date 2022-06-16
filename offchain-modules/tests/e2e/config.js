export default class Config {
  constructor() {
    this.httpServer = "http://localhost:8080";
  }

  static getIns() {
    if (!Config.ins) {
      Config.ins = new Config();
    }
    return Config.ins;
  }
}
