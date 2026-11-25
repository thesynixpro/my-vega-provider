const test = require('node:test');
const assert = require('node:assert/strict');
const posts = require('../dist/pornhub/posts');

test('Pornhub parser reads the documented videos array', () => {
  const result = posts.parseListing({ videos: [{
    title: 'Sample video', viewkey: 'abc123', default_thumb: '//img.example/a.jpg', duration: '12:34'
  }] });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Sample video');
  assert.equal(result[0].link, 'https://www.pornhub.com/view_video.php?viewkey=abc123');
  assert.equal(result[0].image, 'https://img.example/a.jpg');
});

test('Pornhub parser reads nested API result arrays and alternate field names', () => {
  const result = posts.parseListing({ data: { results: [{
    video_title: 'Nested video', video_url: '/view_video.php?viewkey=def456', thumb: 'https://img.example/b.jpg'
  }] } });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Nested video');
  assert.equal(result[0].link, 'https://www.pornhub.com/view_video.php?viewkey=def456');
});

test('Pornhub parser accepts a top-level array and link/name fields', () => {
  const result = posts.parseListing([{ name: 'Array video', link: 'https://www.pornhub.com/view_video.php?viewkey=ghi789' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Array video');
});

test('Pornhub parser removes duplicate links', () => {
  const result = posts.parseListing({ videos: [
    { title: 'One', viewkey: 'same' }, { title: 'Duplicate', viewkey: 'same' }
  ] });
  assert.equal(result.length, 1);
});
