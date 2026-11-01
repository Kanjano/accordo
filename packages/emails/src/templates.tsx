import { Button, Text } from '@react-email/components';
import { button, code, Layout, text } from './layout.js';

export function VerifyEmail({ name, url }: { name: string; url: string }) {
  return (
    <Layout preview="Conferma il tuo indirizzo email">
      <Text style={text}>Ciao {name},</Text>
      <Text style={text}>
        conferma il tuo indirizzo email per iniziare a comprare e vendere su Accordo.
      </Text>
      <Button href={url} style={button}>
        Conferma email
      </Button>
      <Text style={text}>
        Il link scade tra un'ora. Se non hai creato tu l'account, ignora questa email.
      </Text>
    </Layout>
  );
}

export function ResetPassword({ name, url }: { name: string; url: string }) {
  return (
    <Layout preview="Reimposta la password">
      <Text style={text}>Ciao {name},</Text>
      <Text style={text}>abbiamo ricevuto una richiesta di reimpostazione della password.</Text>
      <Button href={url} style={button}>
        Scegli una nuova password
      </Button>
      <Text style={text}>
        Il link scade tra un'ora. Se non l'hai chiesto tu, ignora questa email: la password resta
        invariata.
      </Text>
    </Layout>
  );
}

export function NewDeviceLogin({
  name,
  when,
  device,
  url,
}: {
  name: string;
  when: string;
  device: string;
  url: string;
}) {
  return (
    <Layout preview="Nuovo accesso al tuo account">
      <Text style={text}>Ciao {name},</Text>
      <Text style={text}>
        il {when} è stato effettuato un accesso al tuo account da un dispositivo che non conoscevamo
        ({device}).
      </Text>
      <Text style={text}>
        Se sei stato tu, non devi fare nulla. Altrimenti blocca l'accesso: disconnetteremo tutti i
        dispositivi e ti chiederemo di scegliere una nuova password.
      </Text>
      <Button href={url} style={button}>
        Non sono stato io
      </Button>
    </Layout>
  );
}

export function StepUpCode({ name, code: value }: { name: string; code: string }) {
  return (
    <Layout preview={`Il tuo codice di verifica: ${value}`}>
      <Text style={text}>Ciao {name},</Text>
      <Text style={text}>usa questo codice per confermare l'operazione richiesta su Accordo:</Text>
      <Text style={code}>{value}</Text>
      <Text style={text}>
        Il codice scade tra 10 minuti. Non comunicarlo a nessuno, nemmeno a chi dice di lavorare per
        Accordo.
      </Text>
    </Layout>
  );
}

export function PasswordChanged({ name, url }: { name: string; url: string }) {
  return (
    <Layout preview="La tua password è stata cambiata">
      <Text style={text}>Ciao {name},</Text>
      <Text style={text}>
        la password del tuo account è stata cambiata e gli altri dispositivi sono stati disconnessi.
      </Text>
      <Text style={text}>Se non sei stato tu, reimposta subito la password:</Text>
      <Button href={url} style={button}>
        Reimposta la password
      </Button>
    </Layout>
  );
}

export function Notification({
  name,
  title,
  body,
  url,
  cta,
}: {
  name: string;
  title: string;
  body: string;
  url?: string;
  cta?: string;
}) {
  return (
    <Layout preview={title}>
      <Text style={text}>Ciao {name},</Text>
      <Text style={{ ...text, fontWeight: 700 }}>{title}</Text>
      <Text style={text}>{body}</Text>
      {url ? (
        <Button href={url} style={button}>
          {cta ?? 'Apri su Accordo'}
        </Button>
      ) : null}
      <Text style={{ ...text, fontSize: '13px', color: '#7a726b' }}>
        Puoi scegliere quali avvisi ricevere via email da Il mio account → Notifiche.
      </Text>
    </Layout>
  );
}
