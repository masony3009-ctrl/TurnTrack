import assert from "node:assert/strict";
import { test } from "node:test";
import { fitWithin, MAX_HOUSE_PHOTOS, PHOTO_EDGE, photoCount, photoIdsOf, photosLeft, withoutPhoto, withPhotos } from "../notePhotos.ts";

test("photoIdsOf keeps valid ids once, in order", () => {
  assert.deepEqual(photoIdsOf(["abcDEF123456", "abcDEF123456", "x", 7, null, "zzzzzzzzzz", "has space here"]), ["abcDEF123456", "zzzzzzzzzz"]);
  assert.deepEqual(photoIdsOf(undefined), []);
  assert.deepEqual(photoIdsOf("abcDEF123456"), []);
});

test("fitWithin shrinks the long side, leaves small photos alone", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: PHOTO_EDGE });
  assert.deepEqual(fitWithin(3024, 4032), { height: PHOTO_EDGE });
  assert.deepEqual(fitWithin(2000, 2000, 1024), { width: 1024 });
  assert.equal(fitWithin(1280, 720), null);
  assert.equal(fitWithin(0, 0), null);
  assert.equal(fitWithin(NaN, 100), null);
});

test("adding and removing photo ids", () => {
  assert.deepEqual(withPhotos(["aaaaaa1", "bbbbbb2"], ["bbbbbb2", "cccccc3"], 12), ["aaaaaa1", "bbbbbb2", "cccccc3"]);
  assert.deepEqual(withPhotos(["aaaaaa1"], ["bbbbbb2", "cccccc3"], 2), ["aaaaaa1", "bbbbbb2"]);
  assert.deepEqual(withoutPhoto(["aaaaaa1", "bbbbbb2"], "aaaaaa1"), ["bbbbbb2"]);
  assert.equal(photosLeft(10, MAX_HOUSE_PHOTOS), 2);
  assert.equal(photosLeft(15, MAX_HOUSE_PHOTOS), 0);
  assert.equal(photoCount(1), "1 photo");
  assert.equal(photoCount(3), "3 photos");
});
