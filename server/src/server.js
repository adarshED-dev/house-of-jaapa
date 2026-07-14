import app from './app.js';
import { config } from './config.js';

app.listen(config.port, config.host, () => {
  console.log(`House of Jaapa API running on http://${config.host}:${config.port}`);
});
