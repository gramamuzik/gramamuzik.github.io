async function searchSamples() {
    const path = '/api/search-sample';

    const genre = document.getElementById('genre')?.value || 'all';
    const key = document.getElementById('key')?.value || 'all';
    const bpm = document.getElementById('bpm')?.value || '';
    const mood = document.getElementById('mood')?.value || 'all';
    const country = document.getElementById('country')?.value || 'all';
    const year = document.getElementById('year')?.value || 'all';

    const queryParams = new URLSearchParams({
        genre,
        key,
        bpm,
        mood,
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
        // Gelen verileri işleme kodların buraya gelecek
    } catch (error) {
        console.error('Arama sırasında hata oluştu:', error);
        showErrorState();
    }
}