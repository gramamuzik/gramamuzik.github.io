const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const app = express();

// CORS Ayarları
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// Video Başlığından Temiz Şarkı / Sanatçı Adı Çıkarma
function cleanTitle(title) {
    return title
        .replace(/\[.*?\]|\(.*?\)/g, '') // Parantez ve köşeli parantez içlerini sil
        .replace(/(ft\.|feat\.|hd|4k|official|video|audio|vinyl|rip|sample|rare|remastered|lyrics|prod\.|by)/gi, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Discogs API - Yıl, Ülke ve Albüm Sorgulama
async function fetchDiscogsData(query) {
    if (!process.env.DISCOGS_TOKEN) return { year: 'Bilinmiyor', country: 'Global' };

    try {
        const res = await axios.get('https://api.discogs.com/database/search', {
            params: {
                q: query,
                type: 'release',
                token: process.env.DISCOGS_TOKEN
            },
            headers: { 'User-Agent': 'GramaSampletsApp/1.0' },
            timeout: 3000
        });

        if (res.data.results && res.data.results.length > 0) {
            const match = res.data.results[0];
            return {
                year: match.year || 'Bilinmiyor',
                country: match.country || 'Global'
            };
        }
    } catch (err) {
        console.error('Discogs API Hatası:', err.message);
    }
    return { year: 'Bilinmiyor', country: 'Global' };
}

// GetSongBPM API - BPM ve Key Sorgulama
async function fetchGetSongBpmData(query) {
    if (!process.env.GETSONGBPM_API_KEY) return { bpm: null, key: null };

    try {
        const res = await axios.get('https://getsongbpm.com/api/search/', {
            params: {
                api_key: process.env.GETSONGBPM_API_KEY,
                type: 'both',
                lookup: query
            },
            timeout: 3000
        });

        if (res.data.search && res.data.search.length > 0) {
            const song = res.data.search[0];
            return {
                bpm: song.tempo ? `${song.tempo} BPM` : null,
                key: song.key_of || null
            };
        }
    } catch (err) {
        console.error('GetSongBPM API Hatası:', err.message);
    }
    return { bpm: null, key: null };
}

// Metin Analiz Algoritması (Yedek Filtreleme)
function parseSampleMetadata(title, description, tags = [], fallbackKey, fallbackBpm, fallbackMood) {
    const rawText = `${title} ${description} ${tags.join(' ')}`.toLowerCase();

    // BPM Tespiti
    const bpmRegex = /\b([4-9][0-9]|1[0-9]{2}|2[0-0]{2})(?:\.[0-9])?\s*(?:bpm|tempo)?\b/i;
    const bpmMatch = rawText.match(bpmRegex);
    let bpm = bpmMatch ? `${bpmMatch[1]} BPM` : (fallbackBpm ? `${fallbackBpm} BPM` : 'Serbest');

    // Ton (Key) Tespiti
    const keyRegex = /\b([a-g][b#]?(?:\s*(?:minor|major|min|maj|m))?)\b/i;
    const keyMatch = rawText.match(keyRegex);
    let key = keyMatch && keyMatch[1].length > 1 ? keyMatch[1].toUpperCase() : (fallbackKey && fallbackKey !== 'all' ? fallbackKey : 'Belirsiz');

    // Tema / Duygu Tespiti
    const moodDictionary = {
        'Karanlık / Agresif': ['dark', 'evil', 'scary', 'karanlık', 'creepy', 'gothic', 'aggressive', 'angry', 'sert'],
        'Melankolik / Hüzünlü': ['sad', 'melancholic', 'emotional', 'hüzünlü', 'depressing', 'heartbreak', 'lonely'],
        'Sakin / Chill': ['chill', 'lofi', 'relaxing', 'calm', 'smooth', 'mellow', 'peaceful', 'jazz'],
        'Enerjik / Neşeli': ['happy', 'upbeat', 'energetic', 'cheerful', 'funky', 'groovy', 'disco', 'hype'],
        'Nostaljik / Retro': ['vintage', 'nostalgic', 'retro', 'oldies', '70s', '80s', 'vinyl']
    };

    let mood = fallbackMood && fallbackMood !== 'all' ? fallbackMood : 'Genel / Karmaşık';
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
        const { genre, key, bpm, mood, country, year } = req.query;

        let queryParts = [];
        if (genre && genre !== 'all') queryParts.push(genre);
        if (key && key !== 'all') queryParts.push(key);
        if (bpm) queryParts.push(`${bpm} bpm`);
        if (mood && mood !== 'all') queryParts.push(mood);
        if (country && country !== 'all') queryParts.push(country);
        if (year && year !== 'all') queryParts.push(year);

        queryParts.push('rare sample vinyl rip');
        const excludeParams = '-official -vevo -mv -video -lyrics -remastered -hd -tutorial -rehber -ders -yapımı';

        // 1. YouTube Arama
        const searchResponse = await youtube.search.list({
            part: 'snippet',
            q: `${queryParts.join(' ')} ${excludeParams}`,
            type: 'video',
            videoCategoryId: '10', // Sadece Müzik Kategorisi
            maxResults: 10
        });

        if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
            return res.json({ items: [] });
        }

        const videoIds = searchResponse.data.items.map(item => item.id.videoId).join(',');

        // 2. Videoların Detay/Etiket Bilgilerini Çekme
        const videoDetailsResponse = await youtube.videos.list({
            part: 'snippet',
            id: videoIds
        });

        // 3. Harici Veritabanları ve Analiz Algoritması ile Verileri Zenginleştirme
        const processedItems = await Promise.all(
            videoDetailsResponse.data.items.map(async (item) => {
                const title = item.snippet.title;
                const description = item.snippet.description;
                const tags = item.snippet.tags || [];

                const cleanedTerm = cleanTitle(title);

                // Discogs ve GetSongBPM Servislerini Paralel Çağır
                const [discogs, getsongbpm] = await Promise.all([
                    fetchDiscogsData(cleanedTerm),
                    fetchGetSongBpmData(cleanedTerm)
                ]);

                // Harici API verisi eksikse metin analiz algoritmasını devreye sok
                const fallbackMeta = parseSampleMetadata(title, description, tags, key, bpm, mood);

                return {
                    id: { videoId: item.id },
                    snippet: item.snippet,
                    analyzedInfo: {
                        genre: genre && genre !== 'all' ? genre : 'Karışık',
                        bpm: getsongbpm.bpm || fallbackMeta.bpm,
                        key: getsongbpm.key || fallbackMeta.key,
                        year: discogs.year !== 'Bilinmiyor' ? discogs.year : (year && year !== 'all' ? year : 'Bilinmiyor'),
                        country: discogs.country !== 'Global' ? discogs.country : (country && country !== 'all' ? country : 'Global'),
                        mood: fallbackMeta.mood
                    }
                };
            })
        );

        res.json({ items: processedItems });

    } catch (error) {
        console.error('API Ana Hatası:', error);
        res.status(500).json({ error: 'Arama sırasında bir hata oluştu.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Grama Backend ${PORT} portunda başarıyla başlatıldı.`);
});