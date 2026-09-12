async function generateHmacSignature(timestamp, path, secret) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(`${timestamp}.${path}`);

    const cryptoKey = await window.crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"]
    );

    const signatureBuffer = await window.crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        messageData
    );

    return Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function searchSamples() {
    const path = '/api/search-sample';
    const secret = 'grama_secure_987654321_key';
    const timestamp = Date.now().toString();

    const genre = document.getElementById('genreFilter')?.value || 'all';
    const key = document.getElementById('keyFilter')?.value || 'all';
    const bpm = document.getElementById('bpmFilter')?.value || 'all';
    const mood = document.getElementById('moodFilter')?.value || 'all';
    const viewCount = document.getElementById('viewCountFilter')?.value || 'all';
    const country = document.getElementById('countryFilter')?.value || 'all';
    const year = document.getElementById('yearFilter')?.value || 'all';

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
        const signature = await generateHmacSignature(timestamp, path, secret);

        const response = await fetch(`https://grama-backend.onrender.com${path}?${queryParams}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-timestamp': timestamp,
                'x-signature': signature
            }
        });

        if (!response.ok) {
            throw new Error(`Yetkilendirme veya Sunucu Hatası: ${response.status}`);
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
        container.innerHTML = '<p>Hiçbir sample bulunamadı.</p>';
        return;
    }

    items.forEach(item => {
        const videoId = item.id.videoId;
        const title = item.snippet.title;
        const info = item.analyzedInfo;

        const card = document.createElement('div');
        card.className = 'sample-card';
        card.innerHTML = `
            <h3>${title}</h3>
            <p><strong>Tür:</strong> ${info.genre} | <strong>BPM:</strong> ${info.bpm} | <strong>Nota:</strong> ${info.key}</p>
            <p><strong>Ruh Hali:</strong> ${info.mood} | <strong>İzlenme:</strong> ${info.views}</p>
            <iframe width="100%" height="200" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>
        `;
        container.appendChild(card);
    });
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