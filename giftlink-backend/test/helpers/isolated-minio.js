const { storageError } = require('../../services/item-image-storage-error');

// No operator environment variable may override this reviewed artifact gate.
// Current Community HEAD retains GHSA-hv4r-mvr4-25vw's vulnerable signature gate.
// See docs/milestone-6.5b1-storage.md before implementing any Docker provisioning.
const artifactReview = Object.freeze({
    approved: false,
    source: 'https://github.com/minio/minio',
    commit: '7aac2a2c5b7c882e68c1ce017d8256be2feea27f',
    sourceArchiveSha256: '71794c2df26aad0cc99e8421c58b7aa2dd55969f979b0e7d1e931042e9fabcd6',
    license: 'AGPL-3.0-or-later',
    blocker: 'GHSA-hv4r-mvr4-25vw'
});

async function createIsolatedMinio() {
    // Fail before Docker, volume/port allocation, bucket creation or credential lookup.
    throw storageError('artifact_unapproved', 'fixture', 'not_attempted');
}

if (require.main === module) {
    createIsolatedMinio().catch(error => {
        process.stderr.write(JSON.stringify({ check: 'minio_artifact', category: error.category,
            outcome: error.outcome, advisory: artifactReview.blocker }) + '\n');
        process.exitCode = 1;
    });
}

module.exports = { createIsolatedMinio, artifactReview };
