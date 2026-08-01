import { listChannels } from './index.js';
import { requireLogin } from '../auth/requireLogin.js';

export function registerChannelsRoutes(app) {
  app.get('/api/channels', requireLogin, (req, res) => {
    res.json({ channels: listChannels() });
  });
}
