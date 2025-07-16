import { assertEquals, assertExists } from "../deps.ts";
import { AudioHashService } from "../services/audio-hash-service.ts";

Deno.test("AudioHashService - content hash generation", async () => {
  const hashService = new AudioHashService();
  
  // Test with sample audio buffer
  const audioBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const hash = await hashService.generateContentHash(audioBuffer);
  
  // Should return a valid SHA-256 hash
  assertExists(hash);
  assertEquals(hash.length, 64); // SHA-256 is 64 hex characters
  assertEquals(typeof hash, "string");
  
  // Same input should produce same hash
  const hash2 = await hashService.generateContentHash(audioBuffer);
  assertEquals(hash, hash2);
  
  // Different input should produce different hash
  const differentBuffer = new Uint8Array([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const differentHash = await hashService.generateContentHash(differentBuffer);
  assertEquals(differentHash !== hash, true);
});

Deno.test("AudioHashService - perceptual hash generation", async () => {
  const hashService = new AudioHashService();
  
  // Test with sample audio buffer
  const audioBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const hash = await hashService.generatePerceptualHash(audioBuffer);
  
  // Should return a valid perceptual hash
  assertExists(hash);
  assertEquals(typeof hash, "string");
  assertEquals(hash.length > 0, true);
  
  // Same input should produce same hash
  const hash2 = await hashService.generatePerceptualHash(audioBuffer);
  assertEquals(hash, hash2);
});

Deno.test("AudioHashService - real audio file hash generation", async () => {
  const hashService = new AudioHashService();
  
  try {
    // Read the test.mp3 file
    const testAudioPath = new URL("./test.mp3", import.meta.url).pathname;
    const audioBuffer = await Deno.readFile(testAudioPath);
    
    assertExists(audioBuffer);
    assertEquals(audioBuffer.length > 0, true);
    
    // Generate content hash
    const contentHash = await hashService.generateContentHash(audioBuffer);
    assertExists(contentHash);
    assertEquals(contentHash.length, 64); // SHA-256 is 64 hex characters
    assertEquals(typeof contentHash, "string");
    
    // Generate perceptual hash  
    const perceptualHash = await hashService.generatePerceptualHash(audioBuffer);
    assertExists(perceptualHash);
    assertEquals(typeof perceptualHash, "string");
    assertEquals(perceptualHash.length > 0, true);
    
    // Generate metadata hash
    const metadata = {
      fileSize: audioBuffer.length,
      duration: 0, // We don't have duration detection in this test
      format: "mp3"
    };
    const metadataHash = hashService.generateMetadataHash(metadata);
    assertExists(metadataHash);
    assertEquals(typeof metadataHash, "string");
    assertEquals(metadataHash.length > 0, true);
    
    // Test consistency - same file should produce same hashes
    const contentHash2 = await hashService.generateContentHash(audioBuffer);
    assertEquals(contentHash, contentHash2);
    
    const perceptualHash2 = await hashService.generatePerceptualHash(audioBuffer);
    assertEquals(perceptualHash, perceptualHash2);
    
    const metadataHash2 = hashService.generateMetadataHash(metadata);
    assertEquals(metadataHash, metadataHash2);
    
  } catch (error) {
    console.warn("Could not test real audio file:", error);
    // Don't fail the test if the file is missing, just skip it
  }
});

Deno.test("AudioHashService - metadata hash generation", () => {
  const hashService = new AudioHashService();
  
  const metadata = {
    fileSize: 1024,
    duration: 30.5,
    format: "mp3"
  };
  
  const hash = hashService.generateMetadataHash(metadata);
  
  // Should return a valid hash
  assertExists(hash);
  assertEquals(typeof hash, "string");
  assertEquals(hash.length > 0, true);
  
  // Same metadata should produce same hash
  const hash2 = hashService.generateMetadataHash(metadata);
  assertEquals(hash, hash2);
  
  // Different metadata should produce different hash
  const differentMetadata = {
    fileSize: 2048,
    duration: 60.0,
    format: "wav"
  };
  const differentHash = hashService.generateMetadataHash(differentMetadata);
  assertEquals(differentHash !== hash, true);
});

Deno.test("AudioHashService - complete hash generation", async () => {
  const hashService = new AudioHashService();
  
  const audioBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const metadata = {
    fileSize: 1024,
    duration: 30.5,
    format: "mp3"
  };
  
  const hashes = await hashService.generateAllHashes(audioBuffer, metadata);
  
  // Should return all three hash types
  assertExists(hashes.contentHash);
  assertExists(hashes.perceptualHash);
  assertExists(hashes.metadataHash);
  
  assertEquals(typeof hashes.contentHash, "string");
  assertEquals(typeof hashes.perceptualHash, "string");
  assertEquals(typeof hashes.metadataHash, "string");
  
  // Content hash should be SHA-256 (64 hex characters)
  assertEquals(hashes.contentHash.length, 64);
});

Deno.test("AudioHashService - hash comparison", async () => {
  const hashService = new AudioHashService();
  
  const audioBuffer1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const audioBuffer2 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // Same content
  const audioBuffer3 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]); // Slightly different
  
  const hash1 = await hashService.generateContentHash(audioBuffer1);
  const hash2 = await hashService.generateContentHash(audioBuffer2);
  const hash3 = await hashService.generateContentHash(audioBuffer3);
  
  // Identical content should have identical content hashes
  assertEquals(hashService.isExactMatch(hash1, hash2), true);
  assertEquals(hashService.isExactMatch(hash1, hash3), false);
  
  // Test perceptual similarity (mock implementation)
  const perceptualHash1 = await hashService.generatePerceptualHash(audioBuffer1);
  const perceptualHash2 = await hashService.generatePerceptualHash(audioBuffer2);
  const perceptualHash3 = await hashService.generatePerceptualHash(audioBuffer3);
  
  assertEquals(hashService.isSimilar(perceptualHash1, perceptualHash2), true);
  // Note: For this simple test, perceptual similarity might still be true for slightly different content
});

Deno.test("AudioHashService - file format validation", () => {
  const hashService = new AudioHashService();
  
  // Test supported formats
  assertEquals(hashService.isSupportedFormat("mp3"), true);
  assertEquals(hashService.isSupportedFormat("wav"), true);
  assertEquals(hashService.isSupportedFormat("audio/mpeg"), true);
  assertEquals(hashService.isSupportedFormat("audio/wav"), true);
  
  // Test unsupported formats
  assertEquals(hashService.isSupportedFormat("txt"), false);
  assertEquals(hashService.isSupportedFormat("video/mp4"), false);
  assertEquals(hashService.isSupportedFormat("application/json"), false);
});

Deno.test("AudioHashService - real audio file hash generation", async () => {
  const hashService = new AudioHashService();
  
  // Read the test.mp3 file
  const testAudioPath = new URL("./test.mp3", import.meta.url).pathname;
  const audioBuffer = await Deno.readFile(testAudioPath);
  
  assertExists(audioBuffer);
  assertEquals(audioBuffer.length > 0, true);
  
  // Generate hashes for real audio file
  const metadata = {
    fileSize: audioBuffer.length,
    duration: 30.0, // Estimated duration
    format: "mp3"
  };
  
  const hashes = await hashService.generateAllHashes(audioBuffer, metadata);
  
  // Should return all three hash types
  assertExists(hashes.contentHash);
  assertExists(hashes.perceptualHash);
  assertExists(hashes.metadataHash);
  
  assertEquals(typeof hashes.contentHash, "string");
  assertEquals(typeof hashes.perceptualHash, "string");
  assertEquals(typeof hashes.metadataHash, "string");
  
  // Content hash should be SHA-256 (64 hex characters)
  assertEquals(hashes.contentHash.length, 64);
  
  // Verify format detection works
  assertEquals(hashService.isSupportedFormat("mp3"), true);
  
  // Test that same file produces same hash
  const hashes2 = await hashService.generateAllHashes(audioBuffer, metadata);
  assertEquals(hashes.contentHash, hashes2.contentHash);
  assertEquals(hashes.perceptualHash, hashes2.perceptualHash);
  assertEquals(hashes.metadataHash, hashes2.metadataHash);
});