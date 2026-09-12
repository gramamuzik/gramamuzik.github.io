require('dotenv').config();

// Kritik ortam değişkenlerinin varlığını başlangıçta doğrula
const requiredEnv = ['YOUTUBE_API_KEY'];
for (const env of requiredEnv) {
    if (!process.env[env]) {
        console.error(`[KRİTİK HATA] ${env} ortam değişkeni .env veya Render panelinde tanımlanmamış!`);
        process.exit(1);
    }
}

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const morgan = require('morgan');
const { google } = require('googleapis');
const axios = require('axios');
const hpp = require('hpp');
const { z } = require('zod');
const app = express();

const searchCache = new NodeCache({ stdTTL: 600 });

app.set('trust proxy', 1);

app.use(morgan('dev'));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla istek gönderildi, lütfen bir süre sonra tekrar deneyin.' }
});

app.use('/api/', apiLimiter);
app.use(helmet());
app.use(hpp()); // HTTP Parameter Pollution koruması

const allowedOrigins = [
    'https://gramamuzik.github.io',
    'http://localhost:3000',
    'http://localhost:10000'
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Sağlık kontrolü (Health Check) rotası
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime(), timestamp: new Date() });
});

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

function sanitizeInput(input) {
    if (!input) return 'all';
    return String(input).replace(/[^\w\s\-+.]/gi, '').trim().substring(0, 50);
}

// Zod ile katı veri doğrulama şeması
const searchSchema = z.object({
    genre: z.string().max(50).optional().default('all'),
    key: z.string().max(20).optional().default('all'),
    bpm: z.string().max(20).optional().default('all'),
    mood: z.string().max(50).optional().default('all'),
    viewCount: z.string().max(20).optional().default('all'),
    country: z.string().max(50).optional().default('all'),
    year: z.string().max(20).optional().default('all')
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
        // Zod ile sorgu parametrelerini doğrula
        const validationResult = searchSchema.safeParse(req.query);
        if (!validationResult.success) {
            return res.status(400).json({ 
                error: "Geçersiz parametre formatı", 
                details: validationResult.error.format() 
            });
        }

        const cleanQuery = validationResult.data;
        const genre = sanitizeInput(cleanQuery.genre);
        const key = sanitizeInput(cleanQuery.key);
        const bpm = sanitizeInput(cleanQuery.bpm);
        const mood = sanitizeInput(cleanQuery.mood);
        const viewCount = sanitizeInput(cleanQuery.viewCount);
        const country = sanitizeInput(cleanQuery.country);
        const year = sanitizeInput(cleanQuery.year);

        const cacheKey = JSON.stringify({ genre, key, bpm, mood, viewCount, country, year });
        const cachedResponse = searchCache.get(cacheKey);

        if (cachedResponse) {
            console.log('[LOG] Sonuçlar önbellekten (cache) servis edildi.');
            return res.json(cachedResponse);
        }

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
            const emptyResult = { items: [] };
            searchCache.set(cacheKey, emptyResult);
            return res.json(emptyResult);
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
                        views: viewNum.toLocaleString('tr-TR'),
                        year: discogs.year !== 'Bilinmiyor' ? discogs.year : (year && year !== 'all' ? year : 'Bilinmiyor'),
                        country: discogs.country !== 'Global' ? discogs.country : (country && country !== 'all' ? country : 'Global'),
                        mood: fallbackMeta.mood
                    }
                };
            })
        );

        const finalResponse = { items: processedItems };
        searchCache.set(cacheKey, finalResponse);

        res.json(finalResponse);

    } catch (error) {
        console.error('API Kritik Hata Detayı:', error.message || error);
        res.status(500).json({ error: 'Arama sırasında beklenmeyen bir hata oluştu.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Grama Backend ${PORT} portunda tam donanımlı ve doğrulanmış olarak başlatıldı.`);
});