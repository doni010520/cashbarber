FROM ghcr.io/puppeteer/puppeteer:21.0.0

USER root

WORKDIR /app

# Criar diretório para screenshots
RUN mkdir -p /app/screenshots && chmod 777 /app/screenshots

# Copiar arquivos
COPY package*.json ./

# Instalar dependências sem baixar Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

RUN npm ci --only=production && npm cache clean --force

COPY server.js .

# Permissões
RUN chown -R pptruser:pptruser /app

USER pptruser

EXPOSE 3001

CMD ["node", "server.js"]
