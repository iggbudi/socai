import { listChannels } from '../../../features/channels/index.js';
import { requireLogin } from '../../../features/auth/requireLogin.js';

export function registerChannelsRoutes(app) {
  app.get('/api/channels', requireLogin, (req, res) => {
    res.json({ channels: listChannels() });
  });
}