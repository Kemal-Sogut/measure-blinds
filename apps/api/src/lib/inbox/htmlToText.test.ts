// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Pins HTML-only email conversion: block tags become line breaks,
 * entities decode, head/style/script vanish, and blockquote content is
 * prefixed with ">" so quoteTrim treats it as quoted history.
 */

import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from './htmlToText';

describe('htmlToText', () => {
  it('turns paragraphs and line breaks into lines', () => {
    expect(htmlToText('<p>Hi Jane,</p><p>Thanks!<br>See you</p>')).toBe('Hi Jane,\n\nThanks!\nSee you');
  });

  it('drops head, style and script content', () => {
    expect(
      htmlToText('<html><head><title>x</title><style>p{color:red}</style></head><body><script>alert(1)</script><div>Body</div></body></html>')
    ).toBe('Body');
  });

  it('prefixes blockquote lines with >', () => {
    expect(
      htmlToText('<div>Sounds good</div><blockquote><div>On Monday you wrote:</div><div>Can you come Tuesday?</div></blockquote>')
    ).toBe('Sounds good\n\n> On Monday you wrote:\n> Can you come Tuesday?');
  });

  it('nests quote depth', () => {
    expect(htmlToText('<blockquote>a<blockquote>b</blockquote></blockquote>')).toBe('> a\n>> b');
  });

  it('collapses whitespace inside text', () => {
    expect(htmlToText('<p>Hello\n     there</p>')).toBe('Hello there');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a&nbsp;&amp;&lt;b&gt; &#39;q&#39; &#x2014; &quot;')).toBe("a &<b> 'q' — \"");
  });

  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&bogus;')).toBe('&bogus;');
  });
});
