FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN VITE_JUDGE_DEMO=true npm run build -- --base=./
# The Studio serves the app at its own origin root. Keep relative Vite output
# portable, while resolving static assets correctly on SPA deep links.
RUN node -e "const fs = require('node:fs'); const p = 'dist/index.html'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('<head>', '<head><base href=\"/\">'));"

FROM nginx:alpine
COPY deploy/modelscope/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 7860
CMD ["nginx", "-g", "daemon off;"]
