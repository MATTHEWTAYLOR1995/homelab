FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# Install Chromium and fonts for Puppeteer to run in Alpine
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont ca-certificates \
	&& ln -s /usr/bin/chromium /usr/bin/chromium-browser || true

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
