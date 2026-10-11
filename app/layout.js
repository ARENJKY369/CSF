import '@fontsource-variable/manrope';
import '@fontsource/dm-mono/400.css';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata = {
  title: 'Clear Skies Forecaster — Find your dark sky',
  description:
    'A live observing dashboard for amateur astronomers: sky conditions, light pollution, twilight windows and target visibility.',
  applicationName: 'Clear Skies Forecaster',
};

export const viewport = {
  colorScheme: 'dark',
  themeColor: '#070a0f',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
