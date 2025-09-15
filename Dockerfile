FROM node:18

# Instalar Chromium e dependências
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libgbm1 \
    libnss3 \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configurar Puppeteer para usar o Chromium instalado
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Diretório de trabalho
WORKDIR /app

# Copiar e instalar dependências
COPY package.json .
RUN npm install

# Copiar código
COPY server.js .

# Porta
EXPOSE 3001

# Comando para iniciar
CMD ["node", "server.js"]
