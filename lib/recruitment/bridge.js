const { createEventConsumer } = require('./events');
const { RecruitmentWebClient } = require('./web-client');
  const {
    buildChatMessageEmbed,
    buildStatusChangeEmbed,
    buildApplicationCreatedEmbed,
    buildApplicantReplyEmbed,
    buildReplyButtonRow,
  } = require('./dm-messages');

function createRecruitmentBridge({ client, webBaseUrl, webApiToken, supabaseClient }) {
  const webClient = new RecruitmentWebClient(webBaseUrl, webApiToken);

  async function sendDM(discordUserId, embed, components = [], attachments = []) {
    try {
      const user = await client.users.fetch(discordUserId);
      const files = Array.isArray(attachments)
        ? attachments.map((a) => ({ attachment: a.url, name: a.name }))
        : [];

      const sent = await user.send({
        embeds: [embed],
        components,
        files,
      });
      console.log(
        `[Recruitment:Bridge] DM sent to ${discordUserId}`,
      );
      return { ok: true, messageId: sent.id };
    } catch (error) {
      if (error.code === 50007) {
        console.warn(
          `[Recruitment:Bridge] DM skipped for ${discordUserId}: no mutual guild with the bot (Discord error 50007).`,
        );
      } else {
        console.error(
          `[Recruitment:Bridge] DM delivery failed for ${discordUserId}:`,
          error.message,
        );
      }
      return { ok: false, code: error.code ?? null, message: error.message };
    }
  }

  async function report(eventId, outcome) {
    if (!eventId) return;
    try {
      await webClient.reportDelivery(eventId, outcome);
    } catch (error) {
      // The DM has already been sent or has already failed. A failed report must
      // never break the poller nor change what the applicant saw.
      console.error('[Recruitment:Bridge] Failed to report delivery:', error.message);
    }
  }

  const eventHandlers = {
    'recruitment.chat.message': async (event, row) => {
      const applicantUrl = `${webBaseUrl}/reclutamiento/apply-en-curso/chat`;
      const outcome = await sendDM(
        event.applicantDiscordUserId,
        buildChatMessageEmbed(event),
        [buildReplyButtonRow(applicantUrl)],
        event.attachments || [],
      );
      await report(row?.id, outcome);
    },

    'recruitment.application.status_changed': async (event, row) => {
      const applicantUrl = `${webBaseUrl}/reclutamiento/apply-en-curso/chat`;
      const outcome = await sendDM(
        event.applicantDiscordUserId,
        buildStatusChangeEmbed(event),
        [buildReplyButtonRow(applicantUrl)],
        event.attachments || [],
      );
      await report(row?.id, outcome);
    },

    'recruitment.application.created': async (event, row) => {
      // Self-test/cron submissions carry isTest: the event must still be
      // consumed (marks processed), but no DM is sent to the test applicant.
      if (event.isTest === true) {
        console.log(
          `[Recruitment:Bridge] application.created is a test event; DM skipped for ${event.applicantDiscordUserId}`,
        );
        return;
      }
      const applicantUrl = `${webBaseUrl}/reclutamiento/apply-en-curso/chat`;
      const outcome = await sendDM(
        event.applicantDiscordUserId,
        buildApplicationCreatedEmbed(event),
        [buildReplyButtonRow(applicantUrl)],
        event.attachments || [],
      );
      await report(row?.id, outcome);
    },

    'recruitment.chat.applicant_reply': async (event, row) => {
      const officerUrl = `${webBaseUrl}/zona-raider/configuracion/reclutamiento/${event.applicationId}/chat`;
      const outcome = await sendDM(
        event.officerDiscordUserId,
        buildApplicantReplyEmbed(event),
        [buildReplyButtonRow(officerUrl)],
        event.attachments || [],
      );
      await report(row?.id, outcome);
    },
  };

  const consumer = createEventConsumer(supabaseClient, eventHandlers);

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild) return;

    const content = message.content?.trim();
    const attachments = [...message.attachments.values()].map((a) => ({ url: a.url, name: a.name, contentType: a.contentType }));

    // Allow messages with text, attachments, or both
    if (!content && attachments.length === 0) return;

    console.log(
      `[Recruitment:Bridge] DM received from ${message.author.id}: ${(content || '<attachment>').slice(0, 50)}`,
    );

    try {
      await webClient.relayDiscordMessage(message.author.id, content || '', attachments);
    } catch (error) {
      console.error(
        `[Recruitment:Bridge] Failed to relay DM from ${message.author.id}:`,
        error.message,
      );

      try {
        await message.author.send(
          'Hubo un problema al enviar tu mensaje. Por favor, intenta de nuevo más tarde.',
        );
      } catch (replyError) {
        console.error(
          `[Recruitment:Bridge] Failed to send error reply:`,
          replyError.message,
        );
      }
    }
  });

  function start() {
    consumer.start();
    console.log('[Recruitment:Bridge] Bridge started');
  }

  function stop() {
    consumer.stop();
  }

  return { start, stop };
}

module.exports = {
  createRecruitmentBridge,
};
