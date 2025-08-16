import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import chalk from 'chalk';
import dotenv from 'dotenv';
import inquirer from 'inquirer';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';

// Hide dotenv output
dotenv.config({ debug: false });

console.log(chalk.green.bold('\n🚀 🗳️  ECI Voter List OCR System'));

const log = {
    info: (msg) => console.log(chalk.cyan(`ℹ️  ${msg}`)),
    success: (msg) => console.log(chalk.green(`✅ ${msg}`)),
    warning: (msg) => console.log(chalk.yellow(`⚠️  ${msg}`)),
    error: (msg, apiKey = null) => {
        const keyInfo = apiKey ? ` [API: ${apiKey}]` : '';
        console.log(chalk.red.bold(`❌ ${msg}${keyInfo}`));
    },
    progress: (current, total, msg) => console.log(chalk.yellow(`⚙️  [${chalk.bold.green(current)}/${chalk.bold.green(total)}] ${msg}`)),
    processing: (chunkName, pageRange) => console.log(chalk.yellow(`🚀 [${pageRange}] ${chunkName}: Initializing OCR...`)),
    extracted: (chunkName, pageRange, count) => console.log(chalk.green(`✅ [${pageRange}] ${chunkName}: Extracted ${chalk.bold.green(count)} voters`)),
    metric: (label, value) => console.log(chalk.magenta(`📊 ${label}: ${chalk.bold.green(value)}`)),
    config: (pages, threads) => console.log(`\n⚙️  Configuration: ${chalk.bold.green(pages)} pages/chunk, ${chalk.bold.green(threads)} threads`),
    pdfInfo: (totalPages, chunksCount, pagesPerChunk) => console.log(`📄 PDF Analysis: ${chalk.bold.green(totalPages)} pages → ${chalk.bold.green(chunksCount)} chunks (${chalk.bold.green(pagesPerChunk)} pages/chunk)\n`),
    analytics: (total, duration, output) => {
        console.log(`\n📊 Total Voters Extracted: ${chalk.bold.green(total)}`);
        console.log(`⏱️  Processing Time: ${chalk.bold.yellow(duration)} seconds`);
        console.log(`💾 Output Saved: ${chalk.bold.cyan(output)}\n`);
    },
    retry: (chunkName, pageRange, attempt, newApiKey) => console.log(chalk.magenta(`🔄 [${pageRange}] ${chunkName}: Retry attempt ${attempt} with different API key [${newApiKey}]`))
};

const loadGeminiApiKeys = () => {
    try {
        const raw = process.env.GEMINI_API_KEYS || '[]';
        const keys = JSON.parse(raw);
        if (!Array.isArray(keys) || keys.length === 0) {
            log.warning('No valid GEMINI_API_KEYS found. Exiting...');
            process.exit(0);
        }
        console.log(`\n🔑 ${chalk.magenta(`Gemini API Keys Loaded: ${chalk.bold.green(keys.length)}`)}\n`);
        return keys;
    } catch {
        log.warning(
            'Invalid GEMINI_API_KEYS format in .env. Use JSON array syntax like:\nGEMINI_API_KEYS=["key1","key2",...]'
        );
        process.exit(0);
    }
};

const CONFIG = {
    API_KEYS: loadGeminiApiKeys(),
    TEMP_DIR: process.env.TEMP_DIR || './temp_chunks',
    OUTPUT_DIR: process.env.OUTPUT_DIR || './results',
    REQUESTS_BEFORE_BREAK: parseInt(process.env.REQUESTS_BEFORE_BREAK || '10'),
    BREAK_DURATION_MS: parseInt(process.env.BREAK_DURATION_MS || '60000'),
    MAX_PAGES_PER_CHUNK: Math.min(parseInt(process.env.MAX_PAGES_PER_CHUNK || '5'), 10)
};

const modelPool = CONFIG.API_KEYS.map(key => new GoogleGenerativeAI(key));
let requestCount = 0;

const ensureDirectory = (dirPath, label = 'Directory') => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(chalk.green(`✅ Created ${label}: ${dirPath}`));
    }
};

const calculatePadding = (totalPages) => {
    return Math.max(1, Math.floor(Math.log10(totalPages)) + 1);
};

const formatPageRange = (start, end, padding) => {
    const paddedStart = start.toString().padStart(padding, '0');
    const paddedEnd = end.toString().padStart(padding, '0');
    return `${paddedStart}-${paddedEnd}`;
};

const convertExistingJSONToCSV = async (jsonFilePath, baseName) => {
    try {
        log.info("Converting existing JSON to CSV...");
        let data;
        try {
            data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'))
        } catch (parseError) {
            log.error(`${baseName}: JSON parsing error: ${parseError.message}`);
            data = {};
        }
        if (!data || !data.voters || !Array.isArray(data.voters) || data.voters.length === 0) {
            return;
        }

        const csvContent = [
            '"ID","Name","Father/Husband Name","Address","Age","Gender"',
            ...data.voters.map(voter =>
                `"${voter.voter_id || ''}","${voter.name || ''}","${voter.father_husband_name || ''}","${voter.address || ''}","${voter.age || ''}","${voter.gender || ''}"`
            )
        ].join('\n');

        const csvFileName = `${baseName}_ocr.csv`;
        const csvFilePath = path.join(CONFIG.OUTPUT_DIR, csvFileName);
        fs.writeFileSync(csvFilePath, csvContent, 'utf8');

        log.success(`✅ CSV created: ${csvFileName} (${data.voters.length} voters)`);

    } catch (error) {
        log.error(`CSV conversion failed: ${error.message}`);
    }
};

const voterSchema = {
    description: "Extracted voter information from Hindi electoral roll",
    type: SchemaType.OBJECT,
    properties: {
        total_voters: {
            type: SchemaType.NUMBER,
            description: "Total number of voters extracted"
        },
        voters: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    name: { type: SchemaType.STRING, description: "निर्वाचक का नाम" },
                    father_husband_name: { type: SchemaType.STRING, description: "पिता/पति का नाम" },
                    address: { type: SchemaType.STRING, description: "मकान संख्या" },
                    age: { type: SchemaType.STRING, description: "उम्र" },
                    gender: { type: SchemaType.STRING, description: "लिंग" },
                    voter_id: { type: SchemaType.STRING, description: "Voter ID" }
                },
                required: ["name", "father_husband_name", "address", "age", "gender", "voter_id"]
            }
        }
    },
    required: ["total_voters", "voters"]
};

const handleRateLimit = async () => {
    requestCount++;
    if (requestCount % CONFIG.REQUESTS_BEFORE_BREAK === 0) {
        const breakMinutes = CONFIG.BREAK_DURATION_MS / 60000;
        log.warning(`Rate limit reached (${requestCount} requests). Taking ${breakMinutes} minute break`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.BREAK_DURATION_MS));
        log.info('Break completed. Resuming processing');
    }
};

const getPageCount = async (pdfPath) => {
    try {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        return pdfDoc.getPageCount();
    } catch (error) {
        log.error(`Failed to get page count: ${error.message}`);
        return 0;
    }
};

const splitPDF = async (pdfPath) => {
    try {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const totalPages = pdfDoc.getPageCount();
        const totalChunks = Math.ceil(totalPages / CONFIG.MAX_PAGES_PER_CHUNK);
        const padding = calculatePadding(totalPages);

        log.pdfInfo(totalPages, totalChunks, CONFIG.MAX_PAGES_PER_CHUNK);

        if (totalPages <= CONFIG.MAX_PAGES_PER_CHUNK) {
            log.info('PDF within chunk limit. No splitting required');
            return [{
                path: pdfPath,
                pageRange: [1, totalPages],
                chunkId: 'original',
                formattedPageRange: formatPageRange(1, totalPages, padding)
            }];
        }

        const chunks = [];
        const baseName = path.basename(pdfPath, '.pdf');

        for (let start = 0; start < totalPages; start += CONFIG.MAX_PAGES_PER_CHUNK) {
            const end = Math.min(start + CONFIG.MAX_PAGES_PER_CHUNK, totalPages);
            const chunkDoc = await PDFDocument.create();
            const randomDigits = uuidv4().substring(0, 8);
            const chunkId = `${baseName}_${randomDigits}`;

            const pages = await chunkDoc.copyPages(
                pdfDoc,
                Array.from({ length: end - start }, (_, i) => start + i)
            );
            pages.forEach(page => chunkDoc.addPage(page));

            const chunkPath = path.join(CONFIG.TEMP_DIR, `${chunkId}.pdf`);
            const chunkBytes = await chunkDoc.save();
            fs.writeFileSync(chunkPath, chunkBytes);

            chunks.push({
                path: chunkPath,
                pageRange: [start + 1, end],
                chunkId,
                formattedPageRange: formatPageRange(start + 1, end, padding)
            });
        }

        return chunks;
    } catch (error) {
        log.error(`PDF splitting failed: ${error.message}`);
        throw error;
    }
};

const processPDFChunk = async (chunk, modelInstance, chunkTag, apiKey) => {
    const processWithModel = async (currentModelInstance, currentApiKey, retryAttempt = 0) => {
        try {
            await handleRateLimit();

            if (retryAttempt === 0) {
                log.processing(chunk.chunkId, chunk.formattedPageRange);
            } else {
                log.retry(chunk.chunkId, chunk.formattedPageRange, retryAttempt, currentApiKey);
            }

            const model = currentModelInstance.getGenerativeModel({
                model: "gemini-2.5-flash",
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: voterSchema
                }
            });

            const pdfBuffer = fs.readFileSync(chunk.path);
            const base64Data = pdfBuffer.toString("base64");

            const response = await model.generateContent([
                {
                    text: `Extract all voter information from this Hindi electoral roll PDF.
For each voter, extract: name, father/husband name, address, age, gender, and Voter ID.
Return ALL voters found in JSON format.`
                },
                {
                    inlineData: {
                        mimeType: 'application/pdf',
                        data: base64Data
                    }
                }
            ]);

            const finishReason = response?.response?.candidates?.[0]?.finishReason;
            if (finishReason && finishReason !== 'STOP') {
                const errorMsg = `API Error - Finish Reason: ${finishReason}`;
                log.error(`[${chunk.formattedPageRange}] ${chunk.chunkId}: ${errorMsg}`, currentApiKey);
                return {
                    success: false,
                    error: errorMsg
                };
            }

            let result;
            try {
                const responseText = response?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
                result = JSON.parse(responseText);
            } catch (parseError) {
                log.error(`[${chunk.formattedPageRange}] ${chunk.chunkId}: JSON parse error: ${parseError.message}`, currentApiKey);
                return {
                    success: false,
                    error: `JSON parse error: ${parseError.message}`
                };
            }

            const resultPath = path.join(CONFIG.TEMP_DIR, `result_${chunk.chunkId}.json`);
            fs.writeFileSync(resultPath, JSON.stringify({
                chunkId: chunk.chunkId,
                pageRange: chunk.pageRange,
                formattedPageRange: chunk.formattedPageRange,
                voters: result.voters || [],
                total: result.total_voters || 0,
                timestamp: new Date().toISOString(),
                apiKeyUsed: currentApiKey,
                retryAttempt: retryAttempt
            }, null, 2));

            log.extracted(chunk.chunkId, chunk.formattedPageRange, result.total_voters || 0);

            return {
                success: true,
                chunkId: chunk.chunkId,
                resultPath,
                voterCount: result.total_voters || 0,
                status: 'success'
            };

        } catch (error) {
            log.error(`[${chunk.formattedPageRange}] ${chunk.chunkId}: Processing failed: ${error.message}`, currentApiKey);
            return {
                success: false,
                error: error.message
            };
        }
    };

    const currentApiKeyIndex = CONFIG.API_KEYS.indexOf(apiKey);
    const allErrors = [];

    for (let attempt = 0; attempt < CONFIG.API_KEYS.length; attempt++) {
        const keyIndex = (currentApiKeyIndex + attempt) % CONFIG.API_KEYS.length;
        const tryApiKey = CONFIG.API_KEYS[keyIndex];
        const tryModelInstance = modelPool[keyIndex];

        if (attempt > 0) {
            log.warning(`Taking ${CONFIG.BREAK_DURATION_MS / 1000} seconds break before retrying with different API key`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.BREAK_DURATION_MS));
        }

        const result = await processWithModel(tryModelInstance, tryApiKey, attempt);

        if (result.success) {
            return {
                chunkId: result.chunkId,
                resultPath: result.resultPath,
                voterCount: result.voterCount,
                status: result.status
            };
        } else {
            allErrors.push({
                attempt: attempt + 1,
                apiKey: tryApiKey,
                error: result.error
            });

            if (attempt < CONFIG.API_KEYS.length - 1) {
                log.warning(`Attempt ${attempt + 1} failed with API key ${tryApiKey}: ${result.error}. Trying next key...`);
            }
        }
    }

    log.error(`All ${CONFIG.API_KEYS.length} API keys failed for chunk ${chunk.chunkId}`);

    const errorPath = path.join(CONFIG.TEMP_DIR, `error_${chunk.chunkId}.json`);
    fs.writeFileSync(errorPath, JSON.stringify({
        chunkId: chunk.chunkId,
        pageRange: chunk.pageRange,
        formattedPageRange: chunk.formattedPageRange,
        totalAttempts: CONFIG.API_KEYS.length,
        allErrors: allErrors,
        timestamp: new Date().toISOString()
    }, null, 2));

    return {
        chunkId: chunk.chunkId,
        resultPath: errorPath,
        voterCount: 0,
        status: 'error'
    };
};


const mergeResults = async (chunkResults, originalPath, outputPath) => {
    console.log('');
    log.info('Merging all chunk results');
    ensureDirectory(CONFIG.OUTPUT_DIR, 'output directory');
    const allVoters = [];
    const processingSummary = [];

    for (const chunk of chunkResults) {
        try {
            if (chunk.status === 'success' && fs.existsSync(chunk.resultPath)) {
                const data = JSON.parse(fs.readFileSync(chunk.resultPath, 'utf-8'));
                allVoters.push(...(data.voters || []));
                processingSummary.push({
                    chunkId: chunk.chunkId,
                    voterCount: data.voters.length,
                    status: 'success'
                });
            } else {
                processingSummary.push({
                    chunkId: chunk.chunkId,
                    voterCount: 0,
                    status: chunk.status
                });
            }
        } catch (error) {
            log.warning(`Failed to read chunk ${chunk.chunkId}: ${error.message}`);
        }
    }

    const finalResult = {
        extractionTimestamp: new Date().toISOString(),
        sourceFile: originalPath,
        configuration: {
            pagesPerChunk: CONFIG.MAX_PAGES_PER_CHUNK,
        },
        processingSummary,
        totalVoters: allVoters.length,
        voters: allVoters
    };

    fs.writeFileSync(outputPath, JSON.stringify(finalResult, null, 2), 'utf-8');

    return finalResult;
};

const cleanup = async () => {
    try {
        if (fs.existsSync(CONFIG.TEMP_DIR)) {
            const files = fs.readdirSync(CONFIG.TEMP_DIR);
            for (const file of files) {
                fs.unlinkSync(path.join(CONFIG.TEMP_DIR, file));
            }
            fs.rmdirSync(CONFIG.TEMP_DIR);
            log.info('Cleaned up temporary files');
        }
    } catch (error) {
        log.warning(`Cleanup incomplete: ${error.message}`);
    }
};

const extractVotersFromPDF = async (pdfPath, outputPath) => {
    const startTime = Date.now();

    try {
        if (!fs.existsSync(pdfPath)) {
            throw new Error(`PDF file not found: ${pdfPath}`);
        }

        log.config(CONFIG.MAX_PAGES_PER_CHUNK, CONFIG.API_KEYS.length);

        ensureDirectory(CONFIG.TEMP_DIR, 'temp directory');

        const pageCount = await getPageCount(pdfPath);

        const chunks = await splitPDF(pdfPath);

        const limit = pLimit(CONFIG.API_KEYS.length);

        const chunkPromises = chunks.map((chunk, index) => {
            const modelIndex = index % modelPool.length;
            const modelInstance = modelPool[modelIndex];
            const apiKey = CONFIG.API_KEYS[modelIndex];
            const chunkTag = `${chunk.chunkId}:${chunk.formattedPageRange}`;
            return limit(() => processPDFChunk(chunk, modelInstance, chunkTag, apiKey));
        });

        const chunkResults = await Promise.all(chunkPromises);
        const finalResult = await mergeResults(chunkResults, pdfPath, outputPath);

        await cleanup();

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        log.analytics(finalResult.totalVoters, duration, outputPath);

        return finalResult;

    } catch (error) {
        log.error(`Extraction failed: ${error.message}`);
        await cleanup();
        throw error;
    }
};

async function main() {
    try {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'inputPath',
                message: '📥 Enter the input PDF file path:',
                validate: input => {
                    const fileExists = fs.existsSync(input.trim());
                    if (!fileExists) return '❌ File does not exist. Please enter a valid path.';
                    if (!input.trim().toLowerCase().endsWith('.pdf')) return '❌ Must be a .pdf file.';
                    return true;
                }
            }
        ]);

        const inputPath = answers.inputPath.trim();
        const inputFileName = path.basename(inputPath, '.pdf');
        const outputFilePath = path.join(CONFIG.OUTPUT_DIR, `${inputFileName}_ocr.json`);
        await extractVotersFromPDF(inputPath, outputFilePath);
        // Auto-convert to CSV after successful extraction
        if (fs.existsSync(outputFilePath)) {
            await convertExistingJSONToCSV(outputFilePath, inputFileName);
        }
    } catch (error) {
        log.error(`Fatal error: ${error.message}`);
        process.exit(1);
    }
}

main();
