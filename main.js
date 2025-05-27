const apiKey = 'bc85cb05da0a9fd236d7f9a8fb1b0af1';
let showName = 'The Wire';
// TEST LINE
const TMDB_GENRES = {
  10759: "Action & Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10762: "Kids",
  9648: "Mystery",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
  37: "Western"
};

async function fetchWritersForShow(name) {
  const sr = await fetch(
    `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(name)}`
  );
  const sd = await sr.json();
  const show = sd.results?.[0];
  if (!show) throw new Error('Show not found');

  const showDetailsRes = await fetch(
    `https://api.themoviedb.org/3/tv/${show.id}?api_key=${apiKey}`
  );
  const showDetails = await showDetailsRes.json();
  const creatorIds = (showDetails.created_by || []).map(c => c.id);

  const cr = await fetch(
    `https://api.themoviedb.org/3/tv/${show.id}/aggregate_credits?api_key=${apiKey}`
  );
  const cd = await cr.json();

  const writers = (cd.crew || []).filter(p => p.department === 'Writing')
    .map(w => ({
      ...w,
      isCreator: creatorIds.includes(w.id)
    }));

  return { show, writers, creatorIds };
}

async function fetchShowById(showId) {
  const showDetailsRes = await fetch(
    `https://api.themoviedb.org/3/tv/${showId}?api_key=${apiKey}`
  );
  const showDetails = await showDetailsRes.json();
  const creatorIds = (showDetails.created_by || []).map(c => c.id);

  const cr = await fetch(
    `https://api.themoviedb.org/3/tv/${showId}/aggregate_credits?api_key=${apiKey}`
  );
  const cd = await cr.json();

  const writers = (cd.crew || []).filter(p => p.department === 'Writing')
    .map(w => ({
      ...w,
      isCreator: creatorIds.includes(w.id)
    }));

  return { show: showDetails, writers, creatorIds };
}

const writerSeriesCache = {};
async function fetchSeriesForWriter(writerId) {
  if (writerSeriesCache[writerId]) return writerSeriesCache[writerId];
  const resp = await fetch(
    `https://api.themoviedb.org/3/person/${writerId}/tv_credits?api_key=${apiKey}`
  );
  const data = await resp.json();
  const result = (data.crew || []).filter(c => c.department === 'Writing');
  writerSeriesCache[writerId] = result;
  return result;
}

async function renderGraph(show, writers, creatorIds) {
  // Always destroy previous instance to avoid duplicate handlers
  if (window.cy && typeof window.cy.destroy === 'function') {
    window.cy.destroy();
  }

  let lastActiveNodeId = null; // <-- Move this to the top of renderGraph

  // Hide any open popover when rendering a new graph
  const popover = document.getElementById('show-popover');
  if (popover) popover.style.display = 'none';

  // For the origin show node:
  const originGenres = (show.genre_ids || show.genres || [])
    .map(g => typeof g === 'number' ? TMDB_GENRES[g] : (g.name || TMDB_GENRES[g.id]))
    .filter(Boolean);

  const nodes = [{
    data: {
      id: `show_${show.id}`,
      label: show.name + (show.first_air_date ? ` (${show.first_air_date.slice(0, 4)})` : ''),
      type: 'show',
      genres: originGenres
    },
    classes: 'origin-show'
  }];
  const edges = [];
  const seriesSet = new Set([show.id]);

  // REMOVE THIS BLOCK:
  //// writers.forEach((w, i) => {
  ////   nodes.push({
  ////     data: { id: `writer_${i}`, label: w.name, type: 'writer', tmdbId: w.id },
  ////     classes: w.isCreator ? 'creator' : ''
  ////   });
  ////   edges.push({
  ////     data: { source: `show_${show.id}`, target: `writer_${i}` },
  ////     classes: w.isCreator ? 'origin-creator' : ''
  ////   });
  //// });

  for (let i = 0; i < writers.length; i++) {
    const w = writers[i];
    const otherSeries = await fetchSeriesForWriter(w.id);
    for (const series of otherSeries) {
      if (!seriesSet.has(series.id)) {
        const genres = (series.genre_ids || series.genres || [])
          .map(g => typeof g === 'number' ? TMDB_GENRES[g] : (g.name || TMDB_GENRES[g.id]))
          .filter(Boolean);
        nodes.push({
          data: {
            id: `show_${series.id}`,
            label: series.name + (series.first_air_date ? ` (${series.first_air_date.slice(0, 4)})` : ''),
            type: 'show',
            genres
          }
        });
        seriesSet.add(series.id);
      }
      edges.push({ data: { source: `show_${series.id}`, target: `writer_${i}` } });
    }
  }

  // 1. Build a map from writer index to connected show IDs
  const writerConnections = {};
  writers.forEach((w, i) => {
    writerConnections[i] = new Set();
  });
  edges.forEach(edge => {
    const { source, target } = edge.data;
    if (source.startsWith('show_') && target.startsWith('writer_')) {
      const writerIdx = parseInt(target.replace('writer_', ''), 10);
      const showId = source;
      writerConnections[writerIdx].add(showId);
    }
    if (target.startsWith('show_') && source.startsWith('writer_')) {
      const writerIdx = parseInt(source.replace('writer_', ''), 10);
      const showId = target;
      writerConnections[writerIdx].add(showId);
    }
  });

  // 2. Group writers by their connection signature
  const connectionGroups = {};
  Object.entries(writerConnections).forEach(([idx, showSet]) => {
    const signature = Array.from(showSet).sort().join(',');
    if (!connectionGroups[signature]) connectionGroups[signature] = [];
    connectionGroups[signature].push(parseInt(idx, 10));
  });

  // 3. Build new writer nodes and edges
  const groupedNodes = [];
  const groupedEdges = [];
  const usedWriterIdx = new Set();

  Object.entries(connectionGroups).forEach(([signature, group]) => {
    const showIds = signature ? signature.split(',') : [];
    // Only group if there are at least 2 writers and at least 3 shared shows
    if (group.length > 1 && showIds.length >= 3) {
      const groupWriters = group.map(idx => writers[idx]);
      const label = groupWriters.map(w => w.name).join(', ');
      const tmdbIds = groupWriters.map(w => w.id);
      const isCreator = groupWriters.some(w => w.isCreator);

      // Create a single node for the group
      const groupNodeId = 'writer_group_' + tmdbIds.join('_');
      groupedNodes.push({
        data: { id: groupNodeId, label, type: 'writer', tmdbIds },
        classes: isCreator ? 'creator' : ''
      });

      // Connect to all shows in the signature
      showIds.forEach(showId => {
        const isOriginEdge = showId === `show_${show.id}`;
        groupedEdges.push({
          data: { source: showId, target: groupNodeId },
          classes: isCreator && isOriginEdge ? 'origin-creator' : ''
        });
      });

      group.forEach(idx => usedWriterIdx.add(idx));
    }
  });

  // Add ungrouped writers as individual nodes
  writers.forEach((w, i) => {
    if (!usedWriterIdx.has(i)) {
      groupedNodes.push({
        data: { id: `writer_${i}`, label: w.name, type: 'writer', tmdbId: w.id },
        classes: w.isCreator ? 'creator' : ''
      });
      // Connect to all their shows
      writerConnections[i].forEach(showId => {
        const isOriginEdge = showId === `show_${show.id}`;
        groupedEdges.push({
          data: { source: showId, target: `writer_${i}` },
          classes: w.isCreator && isOriginEdge ? 'origin-creator' : ''
        });
      });
    }
  });

  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: { nodes: [...nodes, ...groupedNodes], edges: [...groupedEdges] },
    style: [
      {
        selector: 'node',
        style: {
          'background-opacity': 0.9,
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-family': 'Fira Sans, Inter, Arial, sans-serif',
          'color': '#F9FAFB',
          'text-wrap': 'wrap',
        }
      },
      {
        selector: 'node[type="show"]',
        style: {
          'shape': 'ellipse',
          'background-color': '#6C3FC5',
          'border-color': '#6C3FC5',
          'border-width': 3,
          'color': '#F9FAFB',
          'width': 140,
          'height': 140,
          'font-size': '16px'
        }
      },
      {
        selector: 'node[type="writer"]',
        style: {
          'shape': 'ellipse',
          'background-color': '#2EC4B6',
          'border-color': '#2EC4B6',
          'color': '#F9FAFB',
          'width': 100,
          'height': 100,
          'font-size': '12px',
          'border-width': 2,
        }
      },
      {
        selector: 'node[type="writer"].creator',
        style: {
          'border-color': '#6C3FC5',
          'border-width': 4,
        }
      },
      {
        selector: 'node.origin-show',
        style: {
          'border-color': '#2EC4B6',
          'border-width': 4
        }
      },
      {
        selector: 'edge',
        style: {
          'line-color': '#E0E7EF',
          'opacity': 0.8,
        }
      },
      {
        selector: 'edge.origin-creator',
        style: {
          'line-color': '#000000',
          'opacity': 1
        }
      },
      {
        selector: 'node:active',
        style: {
          'overlay-opacity': 0,
          'background-opacity': 0.9
        }
      },
      {
        selector: 'node.dimmed',
        style: {
          'opacity': 0.2,
          'color': '#22223b',
          'transition-duration': '200ms'
        }
      },
      {
        selector: 'edge.dimmed',
        style: {
          'opacity': 0.2,
          'transition-duration': '200ms'
        }
      },
      {
        selector: 'node.node-genre-highlight',
        style: {
          // Overlay effect: make node brighter
          'background-color': '#fffbe7', // a bright yellowish overlay
          'background-opacity': 0.3,
          'border-color': '#ffe066',
          'border-width': 5,
          'color': '#22223b', // <-- Make text dark for contrast
          'transition-property': 'background-color, background-opacity, border-color, border-width, color',
          'transition-duration': '200ms'
        }
      }
    ],
    layout: { name: 'cose', fit: true, padding: 40, animate: true },
    minZoom: 0.2,
    maxZoom: 2.75
  });
  window.cy = cy; // always update the global reference

  cy.userZoomingEnabled(true);

  cy.ready(() => {
    // Find the most connected show and writer nodes
    let maxShowDegree = 0, maxWriterDegree = 0;
    let showNodes = [], writerNodes = [];
    cy.nodes().forEach(node => {
      if (node.data('type') === 'show') {
        const degree = node.connectedEdges().length;
        if (degree > maxShowDegree) {
          maxShowDegree = degree;
          showNodes = [node];
        } else if (degree === maxShowDegree) {
          showNodes.push(node);
        }
      } else if (node.data('type') === 'writer') {
        const degree = node.connectedEdges().length;
        if (degree > maxWriterDegree) {
          maxWriterDegree = degree;
          writerNodes = [node];
        } else if (degree === maxWriterDegree) {
          writerNodes.push(node);
        }
      }
    });

    cy.nodes().forEach(node => {
      const degree = node.connectedEdges().length;
      const isOrigin = node.hasClass('origin-show');
      const minSize = node.data('type') === 'show' ? 80 : 50;
      const maxSize = node.data('type') === 'show' ? 180 : 120;
      let size = isOrigin
        ? maxSize
        : Math.min(maxSize, minSize + degree * 15);

      // Largest rectangle in ellipse
      const availWidth = size * 0.707;
      const availHeight = size * 0.707;

      const minFontSize = 12;
      const maxFontSize = 22;
      let fontSize = maxFontSize;
      let label = node.data('label');
      let type = node.data('type');
      let lines = [];
      let fits = false;

      // For shows, keep "The" with next word if present
      if (type === 'show' && label.startsWith('The ')) {
        const parts = label.split(' ');
        if (parts.length > 2) {
          parts[1] = parts[0] + ' ' + parts[1];
          parts.shift();
        }
        label = parts.join(' ');
      }

      // Improved word wrapping and font fitting
      while (fontSize >= minFontSize) {
        const padding = Math.floor(fontSize * 0.3);
        const paddedWidth = availWidth - 2 * padding;
        const paddedHeight = availHeight - 2 * padding;
        const lineHeight = 1.2 * fontSize;
        const font = `${fontSize}px Fira Sans, Inter, Arial, sans-serif`;

        // Word wrap: build lines so that each line fits in paddedWidth
        let words = label.split(' ');
        lines = [];
        let currentLine = '';
        for (let i = 0; i < words.length; i++) {
          let testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
          if (measureTextWidth(testLine, font) <= paddedWidth) {
            currentLine = testLine;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = words[i];
          }
        }
        if (currentLine) lines.push(currentLine);

        // Check if all lines fit horizontally and vertically
        const allLinesFit = lines.every(line => measureTextWidth(line, font) <= paddedWidth);
        const fitsVertically = lines.length * lineHeight <= paddedHeight;

        if (allLinesFit && fitsVertically) {
          fits = true;
          break;
        }
        fontSize -= 1;
      }

      lines = lines.map(toTitleCase);

      const padding = Math.floor(fontSize * 0.3);

      node.style({
        width: size,
        height: size,
        'font-size': `${fontSize}px`,
        'label': lines.join('\n'),
        'text-margin-y': padding // vertical padding
      });
    });

    const originNode = cy.nodes('[id = "show_' + show.id + '"]');
    if (originNode.nonempty()) {
      cy.resize();
      cy.animate({
        fit: { eles: originNode.closedNeighborhood(), padding: getFitPadding() }
      }, { duration: 500, easing: 'ease-in-out-cubic' });

      const neighborhood = originNode.closedNeighborhood();
      cy.elements().addClass('dimmed');
      neighborhood.removeClass('dimmed');

      // After animation, check if centered and re-center if not
      setTimeout(() => {
        if (!isOriginNodeCentered(cy, originNode)) {
          cy.resize();
          cy.animate({
            fit: { eles: originNode.closedNeighborhood(), padding: getFitPadding() }
          }, { duration: 400, easing: 'ease-in-out-cubic' });
        }
      }, 600); // Wait for the initial animation to finish
    }
  });

  cy.on('tap', 'node', evt => {
    lastActiveNodeId = evt.target.id();

    const node = evt.target;
    const neighborhood = node.closedNeighborhood();

    cy.elements().addClass('dimmed');
    neighborhood.removeClass('dimmed');

    cy.animate({
      fit: { eles: neighborhood, padding: getFitPadding() }
    }, { duration: 500, easing: 'ease-in-out-cubic' });
  });

  let lastTapTime = 0;
  cy.on('tap', 'node[type="show"]', async function(evt) {
    const now = Date.now();
    if (now - lastTapTime < 400) {
      const node = evt.target;
      const showId = node.data('id')?.replace('show_', '');
      if (!showId) return;
      showLoading();
      try {
        const { show, writers, creatorIds } = await fetchShowById(showId);
        cy.destroy();
        await renderGraph(show, writers, creatorIds);
        addToNavigationTrail(show);
      } catch (e) {
        alert('Error loading new series. See console.');
        console.error(e);
      } finally {
        hideLoading();
      }
    }
    lastTapTime = now;
  });

  cy.on('tap', function(evt) {
    if (evt.target === cy) {
      cy.elements().removeClass('dimmed');
      const seriesNode = cy.nodes('[type="show"]');
      if (seriesNode.nonempty()) {
        cy.animate({
          center: { eles: seriesNode }
        }, { duration: 300 });
      }

      cy.animate({
        fit: { eles: cy.elements(), padding: getFitPadding() }
      }, { duration: 500, easing: 'ease-in-out-cubic' });
    }
  });

  // Keep graph centered on window resize
  if (!window._cyResizeAttached) {
    window.addEventListener('resize', () => {
      if (window.cy && window.cy.container()) {
        window.cy.resize();
        window.cy.fit(undefined, getFitPadding());
      }
    });
    window._cyResizeAttached = true;
  }

  // Build a mapping from writer index to node ID (grouped or individual)
  const writerIdxToNodeId = {};

  // For grouped writers
  Object.entries(connectionGroups).forEach(([signature, group]) => {
    const showIds = signature ? signature.split(',') : [];
    if (group.length > 1 && showIds.length >= 3) {
      const tmdbIds = group.map(idx => writers[idx].id);
      const groupNodeId = 'writer_group_' + tmdbIds.join('_');
      group.forEach(idx => {
        writerIdxToNodeId[idx] = groupNodeId;
      });
    }
  });

  // For ungrouped writers
  writers.forEach((w, i) => {
    if (!usedWriterIdx.has(i)) {
      writerIdxToNodeId[i] = `writer_${i}`;
    }
  });

  updateOriginHeader(show, writers, writerIdxToNodeId);
  enableHeaderNodeLinks(cy);
  setupShowNodePopover(cy);

  // After fetching/creating the origin show node and its genres:
  const originShowNode = cy.nodes('.origin-show')[0];
  const genres = (originShowNode && originShowNode.data('genres')) || [];

  const genreTagsHtml = genres.map(g =>
    `<span class="genre-tag genre-tag-clickable" data-genre="${g}">${g}</span>`
  ).join('');

  // Example: update the title bar (adjust selector as needed)
  const originSeriesDiv = document.getElementById('origin-series');
  if (originSeriesDiv) {
    // Insert genre tags after the show title
    const titleElem = originSeriesDiv.querySelector('.origin-series-title');
    if (titleElem) {
      // Remove any old genre tags
      const oldTags = originSeriesDiv.querySelectorAll('.genre-tag-clickable');
      oldTags.forEach(tag => tag.remove());
      // Insert new tags
      titleElem.insertAdjacentHTML('afterend', genreTagsHtml);
    }
  }

  // Remove previous event listeners to avoid duplicates
  document.querySelectorAll('.genre-tag-clickable').forEach(tag => {
    tag.onclick = null;
  });

  // Add new click handlers
  document.querySelectorAll('.genre-tag-clickable').forEach(tag => {
    tag.onclick = function() {
      const genre = this.getAttribute('data-genre');
      const wasActive = this.classList.contains('genre-tag-active');

      // Remove active state from all tags
      document.querySelectorAll('.genre-tag-clickable').forEach(other => {
        other.classList.remove('genre-tag-active');
      });

      // Remove genre highlight from all nodes
      cy.nodes().removeClass('node-genre-highlight');

      if (!wasActive) {
        // Activate this tag
        this.classList.add('genre-tag-active');

        // Highlight all show nodes with this genre
        const matchingNodes = cy.nodes('[type="show"]').filter(node =>
          (node.data('genres') || []).includes(genre)
        );
        matchingNodes.addClass('node-genre-highlight');

        // Dim non-matching nodes
        cy.nodes('[type="show"]').forEach(node => {
          if ((node.data('genres') || []).includes(genre)) {
            node.removeClass('dimmed');
          } else {
            node.addClass('dimmed');
          }
        });
        cy.edges().addClass('dimmed');
        matchingNodes.forEach(node => node.connectedEdges().removeClass('dimmed'));

        // Zoom and fit to the matching nodes' neighbourhood
        if (matchingNodes.length > 0) {
          cy.animate({
            fit: { eles: matchingNodes.neighborhood().add(matchingNodes), padding: getFitPadding() }
          }, { duration: 500, easing: 'ease-in-out-cubic' });
        }
      } else {
        // All tags are now inactive, so show only the last active node's neighborhood, or origin show if none
        cy.nodes().removeClass('node-genre-highlight');
        cy.elements().addClass('dimmed');
        let targetNode = null;
        if (lastActiveNodeId) {
          targetNode = cy.getElementById(lastActiveNodeId);
        }
        if (!targetNode || !targetNode.length) {
          // Fallback to origin show
          targetNode = cy.nodes('.origin-show');
        }
        if (targetNode && targetNode.length) {
          // Undim the node itself and its closed neighborhood (nodes + edges)
          const neighborhood = targetNode.closedNeighborhood();
          neighborhood.removeClass('dimmed');
          targetNode.removeClass('dimmed');
        }
      }
    };
  });

  // ... rest of your renderGraph code ...
}

function updateOriginHeader(show, writers, writerIdxToNodeId) {
  const origin = document.getElementById('origin-series');
  if (!origin) return;
  const creators = writers
    .map((w, i) => w.isCreator ? { ...w, idx: i } : null)
    .filter(Boolean);

  origin.innerHTML = `
    <a href="#" class="origin-series-title" data-node="show_${show.id}">${show.name}</a>
    ${
      creators.length > 0
        ? `<div class="by-block">
            <span class="by-label">by</span>
            ${creators.map((w) =>
              `<a href="#" class="origin-series-creators" data-node="${writerIdxToNodeId[w.idx] || `writer_${w.idx}`}">${w.name}</a>`
            ).join(', ')}
          </div>`
        : ''
    }
  `;
}

function enableHeaderNodeLinks(cy) {
  document.querySelectorAll('#origin-series a[data-node]').forEach(link => {
    link.onclick = function(e) {
      e.preventDefault();
      const nodeId = this.getAttribute('data-node');
      const node = cy.getElementById(nodeId);
      if (node && node.nonempty()) {
        const neighborhood = node.closedNeighborhood();
        cy.elements().addClass('dimmed');
        neighborhood.removeClass('dimmed');
        cy.resize();
        cy.animate({
          fit: { eles: neighborhood, padding: getFitPadding() }
        }, { duration: 500, easing: 'ease-in-out-cubic' });
      }
    };
  });
}

let lastSearchResults = null;
let lastSearchQuery = '';

document.getElementById('search-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  showLoading();
  try {
    const input = document.getElementById('search-input');
    const searchResultsDiv = document.getElementById('search-results');
    showName = input.value.trim();
    if (!showName) {
      searchResultsDiv.innerHTML = '<div class="search-error">Please enter a show name.</div>';
      return;
    }

    let sr, sd;
    try {
      sr = await fetch(
        `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(showName)}`
      );
      if (!sr.ok) throw new Error('Network error');
      sd = await sr.json();
    } catch (err) {
      searchResultsDiv.innerHTML = '<div class="search-error">Error fetching data. Please try again.</div>';
      return;
    }

    lastSearchResults = sd.results;
    lastSearchQuery = showName;
    if (!sd.results || sd.results.length === 0) {
      searchResultsDiv.innerHTML = '<div class="search-error">Show not found.</div>';
      return;
    }
    if (sd.results.length === 1) {
      const show = sd.results[0];
      try {
        const { writers, creatorIds } = await fetchWritersForShow(show.name);
        document.getElementById('cy').innerHTML = '';
        await renderGraph(show, writers, creatorIds);
        setOriginShow(show, true);
        searchResultsDiv.innerHTML = '';
      } catch (err) {
        searchResultsDiv.innerHTML = '<div class="search-error">Could not load show details.</div>';
      }
    } else {
      renderDropdown(sd.results, searchResultsDiv);
    }
  } finally {
    hideLoading();
  }
});

function renderDropdown(results, searchResultsDiv) {
  searchResultsDiv.innerHTML = `
    <div id="custom-dropdown" class="dropdown-list">
      ${results.map((s, idx) => {
        // Map genre_ids to names
        const genreNames = (s.genre_ids || [])
          .map(id => TMDB_GENRES[id])
          .filter(Boolean)
          .slice(0, 2); // Show up to 2 genres for brevity
        return `
          <div class="dropdown-item" data-idx="${idx}" tabindex="0">
            ${s.name}
            ${s.first_air_date ? ' <span class="dropdown-year">(' + s.first_air_date.slice(0,4) + ')</span>' : ''}
            ${genreNames.length ? genreNames.map(g => `<span class="genre-tag">${g}</span>`).join('') : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', async function() {
      const idx = this.getAttribute('data-idx');
      const selectedShow = results[idx];
      if (selectedShow) {
        showLoading();
        try {
          const { writers, creatorIds } = await fetchWritersForShow(selectedShow.name);
          document.getElementById('cy').innerHTML = '';
          await renderGraph(selectedShow, writers, creatorIds);
          setOriginShow(selectedShow, true);
          searchResultsDiv.innerHTML = '';
          const dropdown = document.getElementById('custom-dropdown');
          if (dropdown) dropdown.remove();
        } finally {
          hideLoading();
        }
      }
    });
    item.addEventListener('keydown', async function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.click();
      }
    });
  });

  document.addEventListener('mousedown', function handleClickOutside(e) {
    const dropdown = document.getElementById('custom-dropdown');
    const searchContainer = document.getElementById('search-container');
    if (dropdown && !searchContainer.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('mousedown', handleClickOutside);
    }
  });
}

document.getElementById('search-input').addEventListener('focus', function() {
  const input = this.value.trim();
  const searchResultsDiv = document.getElementById('search-results');
  if (
    lastSearchResults &&
    lastSearchResults.length > 1 &&
    input === lastSearchQuery
  ) {
    renderDropdown(lastSearchResults, searchResultsDiv);
  }
});

function getFitPadding() {
  return Math.max(8, Math.min(window.innerWidth, window.innerHeight) * 0.04);
}

// --- Navigation Trail Logic ---

let navigationTrail = [];
let originShow = null;

function setOriginShow(show, resetTrail = false) {
  originShow = { id: show.id, name: show.name };
  if (resetTrail) {
    navigationTrail = [];
  }
  renderNavigationTrail();
}

// Only call this when navigating via graph, NOT on search/dropdown/initial load
async function addToNavigationTrail(newShow) {
  // If the show is already in the trail, simulate a nav trail click
  const existingIdx = navigationTrail.findIndex(item => item.id === newShow.id);
  if (existingIdx !== -1) {
    navigationTrail = navigationTrail.slice(existingIdx + 1);
    setOriginShow(newShow, false);
    showLoading();
    try {
      const { show, writers, creatorIds } = await fetchShowById(newShow.id);
      await renderGraph(show, writers, creatorIds);
    } finally {
      hideLoading();
    }
    return;
  }

  // Add the current originShow to the front of the trail if not already first
  if (
    originShow &&
    (navigationTrail.length === 0 || navigationTrail[0].id !== originShow.id)
  ) {
    navigationTrail.unshift({ id: originShow.id, name: originShow.name });
    // Trim to max 5 items (remove oldest if needed)
    if (navigationTrail.length > 5) {
      navigationTrail.length = 5;
    }
  }
  // Now set the new origin, but do NOT reset the trail
  originShow = { id: newShow.id, name: newShow.name };
  renderNavigationTrail();
}

function renderNavigationTrail() {
  const navDiv = document.getElementById('header-nav-trail');
  if (!navDiv) return;
  let html = '';
  navigationTrail.forEach((item, idx) => {
    html += `<span class="header-nav-arrow">→</span>`;
    html += `<span class="header-nav-item" data-idx="${idx}" data-id="${item.id}">${item.name}</span>`;
  });
  navDiv.innerHTML = html;

  // Click handler for each nav item
  document.querySelectorAll('.header-nav-item').forEach(el => {
    el.onclick = async function() {
      const showId = this.getAttribute('data-id');
      showLoading();
      try {
        const { show, writers, creatorIds } = await fetchShowById(showId);
        const idx = parseInt(this.getAttribute('data-idx'), 10);
        // Remove the clicked item and all newer (to the left), keep only older (to the right)
        navigationTrail = navigationTrail.slice(idx + 1);
        setOriginShow(show, false); // Do NOT reset trail
        await renderGraph(show, writers, creatorIds);
      } finally {
        hideLoading();
      }
    };
  });
}

// --- Initial Load ---
(async () => {
  showLoading();
  try {
    const { show, writers, creatorIds } = await fetchWritersForShow(showName);
    await renderGraph(show, writers, creatorIds);
    setOriginShow(show, true);
  } catch (e) {
    console.error(e);
    alert('Error fetching data. See console.');
  } finally {
    hideLoading();
  }
})();

function showLoading() {
  document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

function isOriginNodeCentered(cy, originNode) {
  if (!originNode || originNode.empty()) return false;
  const pos = originNode.renderedPosition();
  const container = cy.container();
  const rect = container.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  // Allow a margin of error (e.g., 40px)
  return (
    Math.abs(pos.x - centerX) < 40 &&
    Math.abs(pos.y - centerY) < 40
  );
}

function setupShowNodePopover(cy) {
  let hoverTimer = null;
  let lastShowId = null;
  let longPressFired = false;
  let justOpenedPopover = false;

  function openPopover(showId, node) {
    if (lastShowId === showId) return;
    lastShowId = showId;
    node.addClass('cy-node-pressing');
    showShowPopover(showId, node, cy);
    justOpenedPopover = true;
    setTimeout(() => { justOpenedPopover = false; }, 350); // Ignore touchend/tap for 350ms
  }

  function clearPopoverTimer() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    cy.nodes('.cy-node-pressing').removeClass('cy-node-pressing');
    const popover = document.getElementById('show-popover');
    if (popover) {
      popover.classList.remove('popover-visible');
      setTimeout(() => {
        popover.style.display = 'none';
      }, 220);
    }
    lastShowId = null;
    longPressFired = false;
  }

  // Desktop: highlight immediately, popover after 600ms
  cy.on('mouseover', 'node[type="show"]', evt => {
    if ('ontouchstart' in window) return;
    const node = evt.target;
    node.addClass('cy-node-pressing');
    hoverTimer = setTimeout(() => openPopover(node.data('id').replace('show_', ''), node), 600);
  });
  cy.on('mouseout', 'node[type="show"]', clearPopoverTimer);

  // Mobile: long press (600ms)
  cy.on('touchstart', 'node[type="show"]', evt => {
    if (!('ontouchstart' in window)) return;
    const node = evt.target;
    longPressFired = false;
    node._pressingTimeout = setTimeout(() => {
      node.addClass('cy-node-pressing');
    }, 400);
    node._popoverTimeout = setTimeout(() => {
      openPopover(node.data('id').replace('show_', ''), node);
      longPressFired = true;
    }, 600);
  });

  cy.on('touchend touchcancel', 'node[type="show"]', evt => {
    const node = evt.target;
    if (node._pressingTimeout) clearTimeout(node._pressingTimeout);
    if (node._popoverTimeout) clearTimeout(node._popoverTimeout);
    // Only close if popover was actually opened by long press, and not immediately after opening
    if (longPressFired && !justOpenedPopover) clearPopoverTimer();
    else cy.nodes('.cy-node-pressing').removeClass('cy-node-pressing');
    longPressFired = false;
  });

  // Only close popover on desktop tap
  cy.on('tap', evt => {
    if (!('ontouchstart' in window)) {
      if (evt.target === cy || evt.target.isNode()) {
        clearPopoverTimer();
      }
    }
  });

  // Close button
  const closeBtn = document.getElementById('popover-close');
  if (closeBtn) {
    closeBtn.onclick = clearPopoverTimer;
  }
}

async function showShowPopover(showId, node, cy) {
  showLoading();
  try {
    const showDetailsRes = await fetch(
      `https://api.themoviedb.org/3/tv/${showId}?api_key=${apiKey}`
    );
    const show = await showDetailsRes.json();
    document.getElementById('popover-title').textContent = show.name;

    // Render genres as clickable tags in the popover
    const genresHtml = (show.genres || []).map(g =>
      `<span class="genre-tag genre-tag-clickable" data-genre="${g.name}">${g.name}</span>`
    ).join('');
    document.getElementById('popover-genres').innerHTML = genresHtml;
    document.getElementById('popover-overview').textContent = show.overview || '';

    // --- FIX: Remove any existing TMDb link before adding a new one ---
    const oldTmdbLinks = document.querySelectorAll('.popover-tmdb-link');
    oldTmdbLinks.forEach(el => el.remove());

    const tmdbUrl = `https://www.themoviedb.org/tv/${show.id}`;
    const tmdbLinkHtml = `<div class="popover-tmdb-link" style="margin-top:0.8em;">
      <a href="${tmdbUrl}" target="_blank" rel="noopener noreferrer">See more at TMDb</a>
    </div>`;
    document.getElementById('popover-overview').insertAdjacentHTML('afterend', tmdbLinkHtml);

    const popover = document.getElementById('show-popover');
    // Remove the class in case it's already visible
    popover.classList.remove('popover-visible');

    // Set initial position and display
    popover.style.display = 'block';

    // Use a timeout to trigger the transition after the browser paints
    setTimeout(() => {
      popover.classList.add('popover-visible');
    }, 10);

    if (window.innerWidth > 700) {
      const pos = node.renderedPosition();
      const rect = cy.container().getBoundingClientRect();
      const nodeWidth = parseFloat(node.style('width')) || 80;
      const nodeHeight = parseFloat(node.style('height')) || 80;

      popover.style.display = 'block';
      popover.style.left = '0px';
      popover.style.top = '0px';
      popover.style.transform = 'none';

      requestAnimationFrame(() => {
        const popRect = popover.getBoundingClientRect();
        const gap = 3;
        let x = rect.left + pos.x;
        let y = rect.top + pos.y;
        let showLeft = false;

        // If not enough space on the right, show to the left
        if (x + gap + popRect.width > window.innerWidth - 8) showLeft = true;
        if (showLeft && x - gap - popRect.width < 8) showLeft = false;

        if (showLeft) {
          popover.style.left = `${x - gap}px`;
          popover.style.transform = 'translate(-100%, -50%)';
        } else {
          popover.style.left = `${x + gap}px`;
          popover.style.transform = 'translate(0, -50%)';
        }
        popover.style.top = `${y}px`;

        adjustPopoverInViewport(popover, x, y, showLeft);
      });
    } else {
      popover.style.left = '';
      popover.style.top = '';
      popover.style.display = 'block';
      popover.style.transform = '';
    }

    // Add click handler for popover genre tags
    document.querySelectorAll('#popover-genres .genre-tag-clickable').forEach(tag => {
      tag.onclick = function() {
        const genre = this.getAttribute('data-genre');
        // Remove active state from all tags (both title bar and popover)
        document.querySelectorAll('.genre-tag-clickable').forEach(other => {
          other.classList.remove('genre-tag-active');
        });
        // Remove genre highlight from all nodes
        cy.nodes().removeClass('node-genre-highlight');

        // Activate this tag
        this.classList.add('genre-tag-active');

        // Highlight all show nodes with this genre
        const matchingNodes = cy.nodes('[type="show"]').filter(node =>
          (node.data('genres') || []).includes(genre)
        );
        matchingNodes.addClass('node-genre-highlight');

        // Dim non-matching nodes
        cy.nodes('[type="show"]').forEach(node => {
          if ((node.data('genres') || []).includes(genre)) {
            node.removeClass('dimmed');
          } else {
            node.addClass('dimmed');
          }
        });
        cy.edges().addClass('dimmed');
        matchingNodes.forEach(node => node.connectedEdges().removeClass('dimmed'));

        // Zoom and fit to the matching nodes' neighbourhood
        if (matchingNodes.length > 0) {
          cy.animate({
            fit: { eles: matchingNodes.neighborhood().add(matchingNodes), padding: getFitPadding() }
          }, { duration: 500, easing: 'ease-in-out-cubic' });
        }
      };
    });
  } finally {
    hideLoading();
  }
}

// Update adjustment function to handle left-aligned popover
function adjustPopoverInViewport(popover, x, y, alignLeft = false) {
  requestAnimationFrame(() => {
    const rect = popover.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Adjust horizontally if needed
    if (rect.left < 0) {
      popover.style.left = `8px`;
    } else if (rect.right > viewportWidth) {
      popover.style.left = `${viewportWidth - rect.width - 8}px`;
    }

    // Adjust vertically if needed
    if (rect.top < 0) {
      popover.style.top = `8px`;
      popover.style.transform = 'translate(0, 0)';
    } else if (rect.bottom > viewportHeight) {
      popover.style.top = `${viewportHeight - rect.height - 8}px`;
      popover.style.transform = 'translate(0, 0)';
    } else if (!alignLeft) {
      // If not already adjusted, keep vertically centered
      popover.style.transform = 'translate(0, -50%)';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const searchBar = document.getElementById('bottom-search-bar');
  const showSearchBtn = document.getElementById('show-search-btn');
  if (showSearchBtn && searchBar) {
    // Only show button on mobile
    if (window.innerWidth <= 700) showSearchBtn.style.display = 'flex';
    showSearchBtn.onclick = () => {
      searchBar.classList.toggle('open');
      if (searchBar.classList.contains('open')) {
        setTimeout(() => {
          document.getElementById('search-input').focus();
        }, 100);
      }
    };
  }
  // Optional: hide search bar when clicking outside
  document.addEventListener('click', (e) => {
    if (
      window.innerWidth <= 700 &&
      searchBar.classList.contains('open') &&
      !searchBar.contains(e.target) &&
      e.target !== showSearchBtn
    ) {
      searchBar.classList.remove('open');
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const siteTitle = document.getElementById('site-title');
  if (siteTitle) {
    siteTitle.style.cursor = 'pointer';
    siteTitle.title = 'Reset to The Wire';
    siteTitle.addEventListener('click', async () => {
      showLoading();
      try {
        const { show, writers, creatorIds } = await fetchWritersForShow('The Wire');
        if (window.cy && typeof window.cy.destroy === 'function') {
          window.cy.destroy();
        }
        await renderGraph(show, writers, creatorIds);
        setOriginShow(show, true);
      } catch (e) {
        alert('Error resetting to The Wire.');
        console.error(e);
      } finally {
        hideLoading();
      }
    });
  }
});

function showPopover(popover, x, y) {
  // Set initial position
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;
  popover.style.transform = 'translate(-50%, 0)';

  // Wait for the popover to render and get its size
  requestAnimationFrame(() => {
    const rect = popover.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Adjust horizontally if needed
    if (rect.left < 0) {
      popover.style.left = `${rect.width / 2 + 8}px`;
    } else if (rect.right > viewportWidth) {
      popover.style.left = `${viewportWidth - rect.width / 2 - 8}px`;
    }

    // Adjust vertically if needed
    if (rect.bottom > viewportHeight) {
      // Show above the cursor/node if it would overflow at the bottom
      popover.style.top = `${y - rect.height - 12}px`;
      popover.style.transform = 'translate(-50%, 0)';
    }
    if (rect.top < 0) {
      popover.style.top = `8px`;
    }
  });
}

function toTitleCase(str) {
  return str.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

function splitWriterName(label, maxCharsPerLine = 16) {
  const firstSpaceIdx = label.indexOf(' ');
  if (firstSpaceIdx === -1) return [label]; // Single word

  const firstLine = label.slice(0, firstSpaceIdx);
  let remaining = label.slice(firstSpaceIdx + 1);

  // Always start the second line, even if it would fit on the first
  const lines = [firstLine];

  // Now wrap the remaining part if needed
  const words = remaining.split(' ');
  let currentLine = '';
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    if (currentLine.length === 0) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

function wrapWords(label, maxCharsPerLine) {
  const words = label.split(' ');
  let lines = [];
  let currentLine = '';
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    if (currentLine.length === 0) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// (Removed duplicate global cy.nodes() and event handler code. All such logic is already handled inside renderGraph.)
// lastActiveNodeId is now declared and used only inside renderGraph.

function measureTextWidth(text, font) {
  const canvas = measureTextWidth._canvas || (measureTextWidth._canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = font;
  return context.measureText(text).width;
}

// In updateOriginHeader:
function updateOriginHeader(show, writers, writerIdxToNodeId) {
  const origin = document.getElementById('origin-series');
  if (!origin) return;
  const creators = writers
    .map((w, i) => w.isCreator ? { ...w, idx: i } : null)
    .filter(Boolean);

  origin.innerHTML = `
    <a href="#" class="origin-series-title" data-node="show_${show.id}">${show.name}</a>
    ${
      creators.length > 0
        ? `<div class="by-block">
            <span class="by-label">by</span>
            ${creators.map((w) =>
              `<a href="#" class="origin-series-creators" data-node="${writerIdxToNodeId[w.idx] || `writer_${w.idx}`}">${w.name}</a>`
            ).join(', ')}
          </div>`
        : ''
    }
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  const legendBtn = document.getElementById('legend-btn');
  const legendModal = document.getElementById('legend-modal');
  const legendClose = document.getElementById('legend-close');
  if (legendBtn && legendModal && legendClose) {
    legendBtn.onclick = () => legendModal.classList.add('active');
    legendClose.onclick = () => legendModal.classList.remove('active');
    legendModal.onclick = (e) => {
      if (e.target === legendModal) legendModal.classList.remove('active');
    };
  }
});