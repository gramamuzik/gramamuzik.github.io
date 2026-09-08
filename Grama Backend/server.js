const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const app = express();

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// Metin, Açıklama ve Etiketlerden Derin Müzik Analizi Yapan Algoritma
function parseSampleMetadata(title, description, tags = [], fallbackKey, fallbackBpm) {
    const rawText = `${title} ${description} ${tags.join(' ')}`.toLowerCase();

    // 1. Gelişmiş BPM Tespiti (Örn: 95bpm, tempo: 120, 140 bpm, 90.5 bpm)
    const bpmRegex = /\b([4-9][0-9]|1[0-9]{2}|2[0-0]{2})(?:\.[0-9])?\s*(?:bpm|tempo)?\b/i;
    const bpmMatch = rawText.match(bpmRegex);
    let bpm = bpmMatch ? `${bpmMatch[1]} BPM` : (fallbackBpm ? `${fallbackBpm} BPM` : 'Serbest / Belirsiz');

    // 2. Gelişmiş Ton (Key) Tespiti (Örn: C#m, A minor, F# Maj, Eb, Dmin, Bb minor)
    const keyRegex = /\b([a-g][b#]?(?:\s*(?:minor|major|min|maj|m))?)\b/i;
    const keyMatch = rawText.match(keyRegex);
    let key = keyMatch && keyMatch[1].length > 1 ? keyMatch[1].toUpperCase() : (fallbackKey && fallbackKey !== 'all' ? fallbackKey : 'Belirsiz');

    // 3. Tema / Duygu Tespiti
    const moodDictionary = {
        'Karanlık / Dark': ['dark', 'evil', 'scary', 'spooky', 'karanlık', 'creepy', 'gothic'],
        'Melankolik / Hüzünlü': ['sad', 'melancholic', 'emotional', 'hüzünlü', 'depressing', 'heartbreak', 'lonely'],
        'Sakin / Chill': ['chill', 'lofi', 'relaxing', 'calm', 'smooth', 'mellow', 'peaceful', 'jazz'],
        'Neşeli / Enerjik': ['happy', 'upbeat', 'energetic', 'cheerful', 'funky', 'groovy', 'disco'],
        'Sert / Aggressive': ['aggressive', 'hard', 'heavy', 'hardcore', 'angry', 'sert', 'drill']
    };

    let mood = 'Genel / Karmaşık';
    for (const [moodName, keywords] of Object.entries(moodDictionary)) {
        if (keywords.some(kw => rawText.includes(kw))) {
            mood = moodName;
            break;
        }
    }

    return { bpm, key, mood };
}

app.get('/api/search-sample', async (req, res) => {
    try {
        const { genre, key, bpm } = req.query;

        let queryParts = [];
        if (genre && genre !== 'all') queryParts.push(genre);
        if (key && key !== 'all') queryParts.push(key);
        if (bpm) queryParts.push(`${bpm} bpm`);

        queryParts.push('rare sample vinyl rip');
        const excludeParams = '-official -vevo -mv -video -lyrics -remastered -hd -tutorial -rehber -ders -yapımı';

        // 1. YouTube Arama İsteği
        const searchResponse = await youtube.search.list({
            part: 'snippet',
            q: `${queryParts.join(' ')} ${excludeParams}`,
            type: 'video',
            videoCategoryId: '10',
            maxResults: 15
        });

        const videoIds = searchResponse.data.items.map(item => item.id.videoId).join(',');

        if (!videoIds) {
            return res.json({ items: [] });
        }

        // 2. Videoların Detaylı Bilgilerini ve Etiketlerini (Tags) Çekme
        const videoDetailsResponse = await youtube.videos.list({
            part: 'snippet',
            id: videoIds
        });

        // 3. Verileri İşleme
        const processedItems = videoDetailsResponse.data.items.map(item => {
            const title = item.snippet.title;
            const description = item.snippet.description;
            const tags = item.snippet.tags || [];

            const metadata = parseSampleMetadata(title, description, tags, key, bpm);

            return {
                id: { videoId: item.id },
                snippet: item.snippet,
                analyzedInfo: metadata
            };
        });

        res.json({ items: processedItems });

    } catch (error) {
        console.error('API Hatası:', error);
        res.status(500).json({ error: 'Arama sırasında bir hata oluştu.' });
    }
});