require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const app = express();

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

function cleanTitle(title) {
    return title
        .replace(/\[.*?\]|\(.*?\)/g, '')
        .replace(/(ft\.|feat\.|hd|4k|official|video|audio|vinyl|rip|sample|rare|remastered|lyrics|prod\.|by)/gi, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isWithinViewCountRange(views, filter) {
    const num = parseInt(views, 10) || 0;
    if (!filter || filter === 'all') return true;
    if (filter === 'under1k') return num < 1000;
    if (filter === '1k-5k') return num >= 1000 && num <= 5000;
    if (filter === '5k-20k') return num >= 5000 && num <= 20000;
    if (filter === '20k-100k') return num >= 20000 && num <= 100000;
    if (filter === '100k-1m') return num >= 100000 && num <= 1000000;
    if (filter === '1m-50m') return num >= 1000000 && num <= 50000000;
    if (filter === 'over50m') return num > 50000000;
    return true;
}

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

function parseSampleMetadata(title, description, tags = [], fallbackKey, fallbackBpm, fallbackMood) {
    const rawText = `${title} ${description} ${tags.join(' ')}`.toLowerCase();

    const bpmRegex = /\b([4-9][0-9]|1[0-9]{2}|2[0-0]{2})(?:\.[0-9])?\s*(?:bpm|tempo)?\b/i;
    const bpmMatch = rawText.match(bpmRegex);
    let bpm = bpmMatch ? `${bpmMatch[1]} BPM` : (fallbackBpm ? `${fallbackBpm} BPM` : 'Serbest');

    const keyRegex = /\b([a-g][b#]?(?:\s*(?:minor|major|min|maj|m))?)\b/i;
    const keyMatch = rawText.match(keyRegex);
    let key = keyMatch && keyMatch[1].length > 1 ? keyMatch[1].toUpperCase() : (fallbackKey && fallbackKey !== 'all' ? fallbackKey : 'Belirsiz');

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
        const { genre, key, bpm, mood, viewCount, country, year } = req.query;

        let mainQueryParts = [];

        if (genre && genre !== 'all') mainQueryParts.push(genre);
        if (country && country !== 'all') mainQueryParts.push(country);
        if (year && year !== 'all') mainQueryParts.push(year);

        if (mainQueryParts.length === 0) {
            mainQueryParts.push('rare sample vinyl');
        } else {
            mainQueryParts.push('sample');
        }

        const searchQuery = mainQueryParts.join(' ');
        const excludeParams = '-official -vevo -tutorial -ders -yapımı';

        console.log(`[LOG] YouTube Arama Sorgusu: "${searchQuery}"`);

        const searchResponse = await youtube.search.list({
            part: 'snippet',
            q: `${searchQuery} ${excludeParams}`,
            type: 'video',
            videoCategoryId: '10',
            maxResults: 50
        });

        if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
            return res.json({ items: [] });
        }

        const videoIds = searchResponse.data.items.map(item => item.id.videoId).join(',');

        const videoDetailsResponse = await youtube.videos.list({
            part: 'snippet,statistics',
            id: videoIds
        });

        let matchedItems = videoDetailsResponse.data.items.filter(item => {
            const views = item.statistics ? item.statistics.viewCount : 0;
            return isWithinViewCountRange(views, viewCount);
        });

        if (matchedItems.length === 0) {
            console.log('[LOG] İzlenme filtresine uyan sonuç bulunamadı, genel havuz kullanılıyor.');
            matchedItems = videoDetailsResponse.data.items;
        }

        const processedItems = await Promise.all(
            matchedItems.map(async (item) => {
                const title = item.snippet.title;
                const description = item.snippet.description;
                const tags = item.snippet.tags || [];
                const viewNum = item.statistics ? parseInt(item.statistics.viewCount, 10) : 0;

                const cleanedTerm = cleanTitle(title);

                const [discogs, getsongbpm] = await Promise.all([
                    fetchDiscogsData(cleanedTerm),
                    fetchGetSongBpmData(cleanedTerm)
                ]);

                const fallbackMeta = parseSampleMetadata(title, description, tags, key, bpm, mood);

                return {
                    id: { videoId: item.id },
                    snippet: item.snippet,
                    analyzedInfo: {
                        genre: genre && genre !== 'all' ? genre : 'Karışık',
                        bpm: getsongbpm.bpm || fallbackMeta.bpm,
                        key: getsongbpm.key || fallbackMeta.key,
                        views: viewCount.toLocaleString('tr-TR'),
                        year: discogs.year !== 'Bilinmiyor' ? discogs.year : (year && year !== 'all' ? year : 'Bilinmiyor'),
                        country: discogs.country !== 'Global' ? discogs.country : (country && country !== 'all' ? country : 'Global'),
                        mood: fallbackMeta.mood
                    }
                };
            })
        );

        res.json({ items: processedItems });

    } catch (error) {
        console.error('API Ana Hatası:', error.message || error);
        res.status(500).json({ error: 'Arama sırasında bir hata oluştu.', details: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Grama Backend ${PORT} portunda başlatıldı.`);
});