# N8N-Audio Automation

This project manages an **n8n-pro** instance designed for high-performance AI content pipelines, specifically tailored for processing eBooks into audio summaries.

## 🚀 Features
- **n8n-pro**: Custom Docker image with `apk`, `ffmpeg`, and `poppler-utils`.
- **E-Learning Pipeline**: Automated workflows for ingesting topics and generating audio summaries.
- **Audio Generation**: Integrated with platforms like ElevenLabs via community nodes.

## 🛠️ Setup
1. Clone the repository.
2. Run `docker compose up -d`.
3. Access n8n at `http://localhost:5678`.

## 📁 Project Structure
- `Dockerfile`: Custom n8n image definition.
- `docker-compose.yaml`: Container orchestration.
- `*.json`: Exported n8n workflows.
