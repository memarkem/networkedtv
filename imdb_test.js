const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const apiKey = 'bc85cb05da0a9fd236d7f9a8fb1b0af1';
const showId = 1438; // The Wire's TMDb ID

async function run() {
  try {
    // Fetch show details to get creators
    const showRes = await fetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=${apiKey}`);
    const showData = await showRes.json();

    const creators = showData.created_by || [];
    if (!creators.length) {
      console.log('No creators found in show details.');
    } else {
      console.log('Creators (from show details):');
      creators.forEach(person => {
        console.log(`- ${person.name} (ID: ${person.id})`);
      });
    }

    // Fetch aggregate credits for writers
    const creditRes = await fetch(`https://api.themoviedb.org/3/tv/${showId}/aggregate_credits?api_key=${apiKey}`);
    const creditData = await creditRes.json();

    const writers = (creditData.crew || []).filter(person => person.department === 'Writing');
    if (writers.length) {
      console.log('\nWriters:');
      writers.forEach(writer => {
        const jobs = writer.jobs?.map(j => j.job).join(', ') || writer.job || '';
        console.log(`- ${writer.name} | Jobs: ${jobs} | ID: ${writer.id}`);
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
