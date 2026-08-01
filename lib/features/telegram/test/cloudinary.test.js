import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCloudinaryConfigured } from '../media/cloudinary.js';

describe('telegram cloudinary media helpers', () => {
  it('requires all Cloudinary credentials', () => {
    assert.equal(
      isCloudinaryConfigured({ CLOUDINARY_CLOUD_NAME: 'cloud', CLOUDINARY_API_KEY: 'key' }),
      false,
    );
    assert.equal(
      isCloudinaryConfigured({
        CLOUDINARY_CLOUD_NAME: 'cloud',
        CLOUDINARY_API_KEY: 'key',
        CLOUDINARY_API_SECRET: 'secret',
      }),
      true,
    );
  });
});
