import { createApp } from "./app.mjs";
import { config } from "./config.mjs";

const server = createApp();

server.listen(config.port, config.host, () => {
  console.log(`LifePilot API listening on http://${config.host}:${config.port}`);
});
