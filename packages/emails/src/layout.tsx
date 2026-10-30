import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

const styles = {
  body: {
    backgroundColor: '#f6f4f1',
    fontFamily: 'Helvetica, Arial, sans-serif',
    color: '#2b2622',
  },
  container: {
    backgroundColor: '#ffffff',
    margin: '24px auto',
    padding: '32px',
    maxWidth: '560px',
    borderRadius: '8px',
  },
  brand: { fontSize: '20px', fontWeight: 700, color: '#8a5a2b', margin: '0 0 24px' },
  footer: { fontSize: '12px', color: '#7a726b', lineHeight: '18px' },
};

export function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="it">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>Accordo</Text>
          <Section>{children}</Section>
          <Hr />
          <Text style={styles.footer}>
            Hai ricevuto questa email perché hai un account su Accordo. Le comunicazioni ufficiali
            arrivano solo dal nostro dominio: non ti chiederemo mai la password o i dati della carta
            via email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const text = { fontSize: '15px', lineHeight: '24px' };
export const button = {
  backgroundColor: '#8a5a2b',
  color: '#ffffff',
  padding: '12px 20px',
  borderRadius: '6px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
};
export const code = { fontSize: '32px', letterSpacing: '8px', fontWeight: 700, margin: '16px 0' };
