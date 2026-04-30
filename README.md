# Automation Monorepo

This repository serves as a centralized hub for various educational content automation pipelines and AI-driven workflows.

## 🚀 Key Pipelines

### 1. In-Book Conversion Engine (`/In_Book_Conversion_Engine`)
A specialized Node.js application designed to parse educational Learning Objective (LO) and Quiz documents.
- **Functionality**: Converts unstructured `.docx` files into structured `.xlsx` formats (CE, DC, and DR).
- **Source Data**: Processes files located in the `In Book Quiz` directory.
- **Key Files**: `ingest.js` (watcher), `mathWrapper.js` (LaTeX/Math formatting).

### 2. AI Content & Summarization Pipeline
Built on a custom **n8n-pro** Docker infrastructure, this pipeline automates the transformation of eBooks into high-quality audio summaries.
- **n8n Infrastructure**: Customized Docker image with `ffmpeg`, `poppler-utils`, and `apk` for advanced processing.
- **Summarization Workflow**: Automated conversion of PDFs from `summarizer-input/` into text and audio summaries in `summarizer-output/`.
- **Audio Merging**: Automatically prepends intros and appends outros to generated audio using FFmpeg.

### 3. Automation Utility Scripts (`/scripts`)
A collection of Python and JavaScript utilities for data maintenance and n8n workflow management.
- **Excel Tools**: Scripts for fixing merges, reverting sheets, and restoring data integrity.
- **n8n Helpers**: Tools for repairing, updating, and ensuring stable execution of n8n flows.

## 🛠️ Infrastructure Setup

1. **Clone the repository**: Ensure you have SSH access to `git@github.com:Rbee72/Automation.git`.
2. **Launch n8n**:
   ```bash
   docker compose up -d
   ```
3. **Access**: n8n is available at `http://localhost:5678`.

## 📁 Directory Structure
```
Automation/
├── assets/                     # Shared media assets (intros, outros, etc.)
├── In_Book_Conversion_Engine/  # [CORE] Quiz/LO Parser Logic
├── In Book Quiz/               # [DATA] Input/Output for Conversion Engine
├── scripts/                    # [UTILITY] Helper scripts and n8n JSON exports
│   └── workflows/              # Exported n8n workflow definitions
├── summarizer-input/           # [DATA] Raw eBooks/PDFs for summarization
├── summarizer-output/          # [DATA] Generated audio/text summaries
├── Dockerfile                  # n8n-pro image definition
├── docker-compose.yaml         # Container orchestration
└── package.json                # Root dependencies
```

---
*Maintained by Rajat Bista*
