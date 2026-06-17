import { listChannels } from '../../../channels/index.js';
import { requireLogin } from '../../middleware/auth.js';

export function registerChannelsRoutes(app) {
  app.get('/api/channels', requireLogin, (req, res) => {
    res.json({ channels: listChannels() });
  });
}