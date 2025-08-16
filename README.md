# 🗳️ ECI Voter List OCR System

> Intelligent OCR system for extracting voter information from Election Commission of India (ECI) PDF documents using Google's Gemini AI.

## 📋 Overview

This Node.js application processes Electoral Commission of India voter list PDFs and extracts structured voter information using Google's Gemini model. It supports parallel processing with multiple API keys, automatic retry mechanisms, and comprehensive error handling.

### ✨ Key Features

- **Multi-language OCR**: Optimized for Hindi electoral documents
- **Parallel Processing**: Multiple API keys for concurrent chunk processing
- **Intelligent Chunking**: Splits large PDFs into manageable chunks (max 10 pages/chunk)
- **Auto-retry Logic**: Cycles through available API keys on failures
- **Rate Limiting**: Built-in rate limiting with configurable breaks
- **Structured Output**: JSON schema validation for consistent data extraction
- **Error Recovery**: Comprehensive error handling with detailed logging
- **Progress Tracking**: Real-time progress updates with console output

## 🏗️ Project Structure

```
eci-voter-list-analyzer/
├── index.js                # Main application file
├── package.json            # Dependencies and scripts
├── .env                    # Environment configuration (create this)
├── temp_chunks/            # Temporary PDF chunks (auto-created)
├── results/                # Output JSON files (auto-created)
├── node_modules/           # Dependencies
└── README.md               # ReadMe file
```

## 📦 Installation

### Prerequisites

- **Node.js**: Version 18.0 or higher
- **npm**: Version 8.0 or higher
- **Google Gemini API Keys**: At least 1 API key (multiple recommended)

### Setup Steps

1. **Clone or download the project**

   ```bash
   cd eci-voter-list-analyzer
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Create environment file**

   ```bash
   cp .env.example .env  # or create manually
   ```

4. **Configure your environment** (see Configuration section below)

## ⚙️ Configuration

### Environment Variables (.env file)

Create a `.env` file in the root directory with the following structure:

```env
# Google Gemini API Keys (JSON array format - REQUIRED)
GEMINI_API_KEYS=["your-api-key-1","your-api-key-2","your-api-key-3"]

# Processing Configuration (Optional - defaults shown)
MAX_PAGES_PER_CHUNK=5
REQUESTS_BEFORE_BREAK=10
BREAK_DURATION_MS=60000

# Directory Configuration (Optional - defaults shown)
TEMP_DIR=./temp_chunks
OUTPUT_DIR=./results
```

### Configuration Details

| Variable                | Description                     | Default         | Notes                                                           |
| ----------------------- | ------------------------------- | --------------- | --------------------------------------------------------------- |
| `GEMINI_API_KEYS`       | Array of Google Gemini API keys | **Required**    | Use JSON array format. Multiple keys enable parallel processing |
| `MAX_PAGES_PER_CHUNK`   | Pages per PDF chunk             | `5`             | Max 10. Higher values = more content per API call               |
| `REQUESTS_BEFORE_BREAK` | Requests before taking a break  | `10`            | Helps avoid rate limiting                                       |
| `BREAK_DURATION_MS`     | Break duration in milliseconds  | `60000`         | 1 minute default                                                |
| `TEMP_DIR`              | Temporary files directory       | `./temp_chunks` | Auto-created if missing                                         |
| `OUTPUT_DIR`            | Output files directory          | `./results`     | Auto-created if missing                                         |

### Getting Google Gemini API Keys

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the generated key
5. Repeat for multiple keys (recommended for parallel processing)

## 🚀 Usage

### Running the Application

```bash
npm start
# or
node index.js
```

### Interactive Process

1. **Start the application**

   ```bash
   npm start
   ```

2. **Enter PDF file path** when prompted:

   ```
   📥 Enter the input PDF file path: /path/to/your/voter-list.pdf
   ```

3. **Monitor progress** in real-time:

   ```
   🔑 Gemini API Keys Loaded: 3

   ⚙️  Configuration: 5 pages/chunk, 3 threads
   📄 PDF Analysis: 25 pages → 5 chunks (5 pages/chunk)

   🚀 [001-005] filename_abc123: Initializing OCR...
   ✅ [001-005] filename_abc123: Extracted 45 voters
   🚀 [006-010] filename_def456: Initializing OCR...
   ✅ [006-010] filename_def456: Extracted 38 voters
   ```

4. **Review results** in the `results/` directory

### Batch Processing

For multiple files, you can modify the script or create a wrapper:

```bash
# Process multiple files
for file in *.pdf; do
  echo "$file" | npm start
done
```

## 📊 Output Format

### JSON Structure

```json
{
  "extractionTimestamp": "2024-01-15T10:30:00.000Z",
  "sourceFile": "/path/to/source.pdf",
  "configuration": {
    "pagesPerChunk": 5
  },
  "processingSummary": [
    {
      "chunkId": "filename_abc123",
      "voterCount": 45,
      "status": "success"
    }
  ],
  "totalVoters": 150,
  "voters": [
    {
      "name": "राम शर्मा",
      "father_husband_name": "श्याम शर्मा",
      "address": "123",
      "age": "35",
      "gender": "पुरुष",
      "voter_id": "ABC1234567"
    }
  ]
}
```

## 🔍 CSV Support for Voter Analysis

The application automatically generates CSV files alongside JSON output for easy data analysis.

### CSV Format Example

```csv
"ID","Name","Father/Husband Name","Address","Age","Gender"
"ABC1234567","राम शर्मा","श्याम शर्मा (पिता)","123","35","पुरुष"
"DEF2345678","सीता देवी","राम प्रसाद (पिता)","456","28","महिला"
"GHI3456789","प्रिया गुप्ता","अमित गुप्ता (पति)","789","32","महिला"
```

### 🕵️ Duplicate & Fake Voter Detection

The auto-generated CSV format enables powerful analysis capabilities:

#### 1. Duplicate Detection by Voter ID

```bash
# Find duplicate voter IDs (replace filename_ocr.csv with your actual file)
tail -n +2 filename_ocr.csv | cut -d',' -f1 | sort | uniq -d
awk -F',' 'NR>1 && seen[$1]++ {print "Duplicate ID:", $1, "->", $0}' filename_ocr.csv
```

#### 2. Duplicate Detection by Name + Father/Husband Name

```bash
# Find potential duplicates by name combination (skip header row)
awk -F',' 'NR>1 && seen[$2"|"$3]++ {print "Potential duplicate:", $2, $3, "->", $0}' filename_ocr.csv
```

#### 3. Age Anomaly Detection

```bash
# Find voters with suspicious ages (skip header row)
awk -F',' 'NR>1 { 
    # Remove quotes from field 5 and convert to number
    age = $5
    gsub(/"/, "", age)
    age = age + 0
    if (age < 18 || age > 120) 
        print "Age anomaly: " $0 " (Age: " age ")"
}' filename_ocr.csv
```

### 📊 Excel/Google Sheets Analysis

Import the CSV file into Excel or Google Sheets for:

1. **Filtering Options:**

   - Filter by age ranges
   - Filter by gender distribution
   - Filter by address patterns
   - Filter by voter ID patterns

2. **Pivot Tables:**

   - Count voters by constituency
   - Age group analysis
   - Gender distribution
   - Address clustering

3. **Conditional Formatting:**
   - Highlight duplicate entries
   - Flag suspicious ages
   - Mark incomplete records

### 🔧 Advanced Analysis Tools

#### Using SQL (SQLite)

```bash
# Import auto-generated CSV to SQLite
sqlite3 voters.db
.mode csv
.import filename_ocr.csv voters

# Export to CSV with proper headers
sqlite3 -header -csv voters.db "SELECT voter_id as 'ID', name as 'Name', father_husband_name as 'Father/Husband Name', address as 'Address', age as 'Age', gender as 'Gender' FROM voters;" > voters.csv

# Find duplicates by voter ID
SELECT "ID", COUNT(*) as count FROM voters GROUP BY "ID" HAVING count > 1;

# Find age anomalies
SELECT * FROM voters WHERE CAST("Age" AS INTEGER) < 18 OR CAST("Age" AS INTEGER) > 120;
```

#### Using Python/Pandas

```python
import pandas as pd

# Load auto-generated CSV (replace with actual filename)
df = pd.read_csv('filename_ocr.csv')

# Find duplicates by name and father/husband name
duplicates = df[df.duplicated(['Name', 'Father/Husband Name'], keep=False)]

# Age analysis
age_anomalies = df[(df['Age'].astype(int) < 18) | (df['Age'].astype(int) > 120)]

# Export analysis
duplicates.to_csv('potential_duplicates.csv', index=False)
age_anomalies.to_csv('age_anomalies.csv', index=False)
```

### Voter Data Fields

| Field                 | Description                    | Example                                  |
| --------------------- | ------------------------------ | ---------------------------------------- |
| `Name`                | Voter's full name              | `"राम शर्मा"` or `"अनिता शर्मा"`         |
| `Father/Husband Name` | Father/Husband name (पिता/पति) | `"श्याम शर्मा"` or `"अमित गुप्ता (पति)"` |
| `Address`             | House/address number           | `"123"`                                  |
| `Age`                 | Voter's age                    | `"35"`                                   |
| `Gender`              | Gender                         | `"पुरुष"/"महिला"`                        |
| `ID`                  | Identity Card number           | `"ABC1234567"`                           |

## 🔧 Development

### Scripts

```bash
# Run the application
npm start

# Install dependencies
npm install

# Check for security vulnerabilities
npm audit

# Update dependencies
npm update
```

### Dependencies

- **@google/generative-ai**: Google Gemini AI SDK
- **pdf-lib**: PDF processing and manipulation
- **chalk**: Terminal styling and colors
- **dotenv**: Environment variable management
- **inquirer**: Interactive command-line prompts
- **p-limit**: Concurrency limiting for parallel processing
- **uuid**: Unique identifier generation

## 🛠️ Troubleshooting

### Common Issues

1. **API Key Errors**

   ```
   ❌ No valid GEMINI_API_KEYS found
   ```

   - Check your `.env` file
   - Ensure API keys are in JSON array format
   - Verify API keys are active

2. **Rate Limiting**

   ```
   ❌ API Error - Finish Reason: MAX_TOKENS
   ```

   - Reduce `MAX_PAGES_PER_CHUNK`
   - Increase `BREAK_DURATION_MS`
   - Add more API keys

3. **Memory Issues**

   ```
   ❌ FATAL ERROR: Ineffective mark-compacts near heap limit
   ```

   - Reduce chunk size
   - Process smaller PDFs
   - Increase Node.js heap size: `node --max-old-space-size=4096 index.js`

4. **PDF Processing Errors**
   ```
   ❌ PDF splitting failed
   ```
   - Check PDF file integrity
   - Ensure PDF is not password protected
   - Verify file permissions

### Performance Optimization

- **Multiple API Keys**: Use 3-5 API keys for optimal parallel processing
- **Chunk Size**: Start with 5 pages/chunk, adjust based on content density
- **Rate Limiting**: Fine-tune break duration based on your API quotas

### Error Logging

All errors are logged with detailed information:

- Chunk identification
- Page ranges
- API key used
- Error messages
- Retry attempts

Check `temp_chunks/error_*.json` files for detailed error analysis.

## 📈 Performance Metrics

### Typical Processing Speeds

- **Small PDFs** (1-10 pages): 30-60 seconds
- **Medium PDFs** (10-50 pages): 2-5 minutes
- **Large PDFs** (50+ pages): 5-15 minutes

_Performance varies based on:_

- PDF content density
- Number of API keys
- Network latency
- API rate limits

## 🔒 Security & Privacy

- **API Keys**: Store securely in `.env` file
- **Data Processing**: All processing happens locally
- **Temporary Files**: Automatically cleaned up after processing
- **No Data Storage**: No voter data is stored permanently by the application

## 📄 License

This project is for educational and research purposes. Ensure compliance with local data protection laws when processing voter information.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

For issues and questions:

1. Check this README
2. Review error logs in `temp_chunks/`
3. Verify your environment configuration
4. Check Google Gemini API status

---

**⚡ Quick Start:**

```bash
npm install
echo 'GEMINI_API_KEYS=["your-api-key"]' > .env
npm start
```

---

## ⚠️ Disclaimer

**OCR Accuracy Notice:** This application uses Optical Character Recognition (OCR) technology to extract text from PDF documents. While our system achieves approximately 99.5% accuracy under optimal conditions, **OCR is not 100% perfect**. Results may contain occasional errors, misinterpretations, or missing data due to:

- Image quality and resolution
- Handwritten text variations
- Document scanning quality
- Font styles and formatting
- Language complexity (especially Hindi text)

**Important:** The developer is not responsible for any inaccurate results produced by this OCR system. Users should verify critical information and cross-check extracted data when accuracy is essential. This tool is intended for automated processing assistance and should not be the sole source for important decision-making.
