async function searchSamples() {
    const path = '/api/search-sample';

    const genre = document.getElementById('genre')?.value || 'all';
    const key = document.getElementById('key')?.value || 'all';
    const bpm = document.getElementById('bpm')?.value || '';
    const mood = document.getElementById('mood')?.value || 'all';
    const viewCount = document.getElementById('viewCountFilter')?.value || 'all';
    const country = document.getElementById('country')?.value || 'all';
    const year = document.getElementById('year')?.value || 'all';

    const queryParams = new URLSearchParams({
        genre,
        key,
        bpm,
        mood,
        viewCount,
        country,
        year
    }).toString();

    try {
        const response = await fetch(`https://grama-backend.onrender.com${path}?${queryParams}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Sunucu Hatası: ${response.status}`);
        }

        const data = await response.json();
        renderResults(data.items);
    } catch (error) {
        console.error('Arama sırasında hata oluştu:', error);
        showErrorState();
    }
}

function renderResults(items) {
    const container = document.getElementById('resultsContainer');
    if (!container) return;

    container.innerHTML = '';

    if (!items || items.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'Hiçbir sample bulunamadı.';
        container.appendChild(p);
        return;
    }

    items.forEach(item => {
        const videoId = item.id.videoId;
        const title = item.snippet.title;
        const info = item.analyzedInfo;

        const card = document.createElement('div');
        card.className = 'sample-card';

        const h3 = document.createElement('h3');
        h3.textContent = title;

        const p1 = document.createElement('p');
        p1.innerHTML = `<strong>Tür:</strong> ${escapeHtml(info.genre)} | <strong>BPM:</strong> ${escapeHtml(info.bpm)} | <strong>Nota:</strong> ${escapeHtml(info.key)}`;

        const p2 = document.createElement('p');
        p2.innerHTML = `<strong>Ruh Hali:</strong> ${escapeHtml(info.mood)} | <strong>İzlenme:</strong> ${escapeHtml(info.views)}`;

        const iframe = document.createElement('iframe');
        iframe.width = '100%';
        iframe.height = '200';
        iframe.src = `https://www.youtube.com/embed/${videoId}`;
        iframe.frameBorder = '0';
        iframe.allowFullscreen = true;

        card.appendChild(h3);
        card.appendChild(p1);
        card.appendChild(p2);
        card.appendChild(iframe);

        container.appendChild(card);
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showErrorState() {
    const container = document.getElementById('resultsContainer');
    if (container) {
        container.innerHTML = '<p style="color: red;">Veriler yüklenirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        searchButton.addEventListener('click', searchSamples);
    }
    searchSamples();
});