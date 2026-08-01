import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escMarkdown, fmtPlan } from '../helpers/format.js';

describe('telegram format helpers', () => {
  it('escapes Telegram Markdown punctuation', () => {
    assert.equal(escMarkdown('_*[]()'), '\\_\\*\\[\\]\\(\\)');
  });

  it('formats a marketing plan summary', () => {
    assert.match(
      fmtPlan({ id: 7, status: 'draft', judul: 'Batik', jadwal: 'Jumat', copywriting: 'Halo' }),
      /#7 \[draft\] Batik/,
    );
  });
});
