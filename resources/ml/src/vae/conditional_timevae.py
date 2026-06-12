"""
conditional_timevae.py
======================
Conditional версия TimeVAE.
Наследуется от ConditionalBaseVariationalAutoencoder.
Полностью сохраняет все возможности оригинального TimeVAE.
"""

import os
import numpy as np
import tensorflow as tf
import joblib

from tensorflow.keras.layers import (
    Conv1D, Flatten, Dense, Conv1DTranspose, Reshape, Input, Layer
)
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam

from vae.conditional_vae_base import ConditionalBaseVariationalAutoencoder, Sampling


class TrendLayer(Layer):
    def __init__(self, feat_dim, trend_poly, seq_len, **kwargs):
        super().__init__(**kwargs)
        self.feat_dim = feat_dim
        self.trend_poly = trend_poly
        self.seq_len = seq_len
        self.trend_dense1 = Dense(feat_dim * trend_poly, activation= None, name="trend_params")
        self.trend_dense2 = Dense(feat_dim * trend_poly, name="trend_params2")
        self.reshape_layer = Reshape(target_shape=(feat_dim, trend_poly))

    def call(self, z):
        trend_params = self.trend_dense1(z)
        trend_params = self.trend_dense2(trend_params)
        trend_params = self.reshape_layer(trend_params)

        lin_space = tf.range(0, float(self.seq_len), 1) / self.seq_len
        poly_space = tf.stack([lin_space ** float(p + 1) for p in range(self.trend_poly)], axis=0)

        trend_vals = tf.matmul(trend_params, poly_space)
        trend_vals = tf.transpose(trend_vals, perm=[0, 2, 1])
        return tf.cast(trend_vals, tf.float32)


class SeasonalLayer(Layer):
    def __init__(self, feat_dim, seq_len, custom_seas, **kwargs):
        super().__init__(**kwargs)
        self.feat_dim = feat_dim
        self.seq_len = seq_len
        self.custom_seas = custom_seas
        self.dense_layers = [Dense(feat_dim * num_seasons, name=f"season_params_{i}") 
                             for i, (num_seasons, _) in enumerate(custom_seas)]
        self.reshape_layers = [Reshape(target_shape=(feat_dim, num_seasons)) 
                               for num_seasons, _ in custom_seas]

    def call(self, z):
        N = tf.shape(z)[0]
        all_seas_vals = []
        for i, (num_seasons, len_per_season) in enumerate(self.custom_seas):
            season_params = self.dense_layers[i](z)
            season_params = self.reshape_layers[i](season_params)

            # Простая реализация сезонности (можно улучшить позже)
            season_vals = tf.tile(season_params[:, :, :1], [1, 1, self.seq_len])
            all_seas_vals.append(season_vals)

        all_seas_vals = tf.reduce_sum(all_seas_vals, axis=0)
        return tf.transpose(all_seas_vals, perm=[0, 2, 1])


class ConditionalTimeVAE(ConditionalBaseVariationalAutoencoder):
    model_name = "ConditionalTimeVAE"

    def __init__(
        self,
        hidden_layer_sizes=None,
        trend_poly=0,
        custom_seas=None,
        use_residual_conn=True,
        std_loss_weight=1.0,
        **kwargs,
    ):
        # Передаём ВСЕ параметры в базовый класс
        super().__init__(
            hidden_layer_sizes=hidden_layer_sizes,
            trend_poly=trend_poly,
            custom_seas=custom_seas,
            use_residual_conn=use_residual_conn,
            std_loss_weight=std_loss_weight,
            **kwargs
        )

        if hidden_layer_sizes is None:
            hidden_layer_sizes = [50, 100, 200]

        self.hidden_layer_sizes = hidden_layer_sizes
        self.trend_poly = trend_poly
        self.custom_seas = custom_seas
        self.use_residual_conn = use_residual_conn

        self.encoder = self._get_encoder()
        self.decoder = self._get_decoder()
        self.compile(optimizer=Adam())

    # ====================== Encoder / Decoder ======================
    def _get_encoder(self):
        encoder_inputs = Input(shape=(self.seq_len, self.feat_dim), name="encoder_input")
        x = encoder_inputs
        for i, num_filters in enumerate(self.hidden_layer_sizes):
            x = Conv1D(filters=num_filters, kernel_size=3, strides=2,
                       activation= None, padding="same", name=f"enc_conv_{i}")(x)

        x = Flatten(name="enc_flatten")(x)
        self.encoder_last_dense_dim = x.shape[-1]

        z_mean = Dense(self.latent_dim, name="z_mean")(x)
        z_log_var = Dense(self.latent_dim, name="z_log_var")(x)

        z = Sampling()([z_mean, z_log_var])

        encoder = Model(encoder_inputs, [z_mean, z_log_var, z], name="encoder")
        return encoder

    def _get_decoder(self):
        z_input = Input(shape=(self.latent_dim,), name="z_input")
        condition_input = Input(shape=(self.seq_len, self.feat_dim), name="condition_input")

        # 1. Основное conditioning
        z_repeated = tf.keras.layers.RepeatVector(self.seq_len)(z_input)
        combined = tf.keras.layers.Concatenate(axis=-1)([z_repeated, condition_input])

        # 2. Основная conditioned часть
        x = condition_input
        for units in self.hidden_layer_sizes:
            x = Dense(units, activation= None)(x)

        x = Dense(self.feat_dim, activation= None, name="decoder_to_feat_dim")(x)
        outputs = x

        # ====================== CONDITIONAL КЛАССИЧЕСКИЕ КОМПОНЕНТЫ ======================

        # === CONDITIONAL LEVEL ===
        #level_z = Dense(self.feat_dim, activation="relu", name="level_params_z")(z_input)
        
        # Правильный способ получить информацию от previous_day
        #combined_mean = tf.keras.layers.GlobalAveragePooling1D()(combined)   # ← вот правильный способ
        condition_mean = tf.keras.layers.GlobalAveragePooling1D()(condition_input)
        ##level_cond = Dense(self.feat_dim, activation="relu", name="level_params_cond")(condition_mean)

        # === CONDITIONAL TREND ===
        if self.trend_poly > 0:
            #trend_z = Dense(self.feat_dim * self.trend_poly, activation="relu")(z_input)
            trend_cond = Dense(self.feat_dim * self.trend_poly, activation= None)(condition_mean)
            #trend_input = trend_z + trend_cond
            trend_input = trend_cond

            trend_vals = TrendLayer(self.feat_dim, self.trend_poly, self.seq_len)(trend_input)
            outputs = outputs + trend_vals


        # === CONDITIONAL SEASONAL ===
        if self.custom_seas is not None and len(self.custom_seas) > 0:
            seasonal_size = sum(num_seasons for num_seasons, _ in self.custom_seas)
            #seasonal_z = Dense(self.feat_dim * seasonal_size, activation="relu")(z_input)
            seasonal_cond = Dense(self.feat_dim * seasonal_size, activation= None)(condition_mean)
            #seasonal_input = seasonal_z + seasonal_cond
            seasonal_input = seasonal_cond

            seasonal_vals = SeasonalLayer(self.feat_dim, self.seq_len, self.custom_seas)(seasonal_input)
            outputs = outputs + seasonal_vals

        # === CONDITIONAL RESIDUAL ===
        if self.use_residual_conn:
            residuals = self._get_decoder_residual(condition_input)   # ← только condition_input
            outputs = outputs + residuals


                # === НОВЫЙ LEVEL BLOCK — anchoring на последнюю цену ===
        last_price = condition_input[:, -1:, :]                    # shape: (batch, 1, feat_dim)
        
        level_params = Dense(self.feat_dim, 
                           activation=None,                        # убрал relu — лучше для уровня цены
                           name="level_params_cond")(last_price)
        
        level_params = Dense(self.feat_dim, 
                           activation=None, 
                           name="level_params2")(level_params)
        
        level_params = Reshape((1, self.feat_dim))(level_params)
        
        ones_tensor = tf.ones((1, self.seq_len, 1), dtype=tf.float32)
        level_vals = level_params * ones_tensor                     # теперь уровень = последняя цена
        outputs = outputs + level_vals * 2
        # Финальный слой
        outputs = Conv1D(filters=self.feat_dim, kernel_size=1, name="final_output")(outputs)

        decoder = Model([z_input, condition_input], outputs, name="decoder")
        return decoder

    def _get_decoder_residual(self, condition_input):
        """Residual полностью conditional — только от previous_day"""
        # Берём среднее по предыдущему дню (или можно взять последнюю свечу)
        cond_mean = tf.keras.layers.GlobalAveragePooling1D()(condition_input)

        x = Dense(self.encoder_last_dense_dim, 
                  activation="relu", 
                  name="dec_dense")(cond_mean)

        x = Reshape((-1, self.hidden_layer_sizes[-1]))(x)

        for i, num_filters in enumerate(reversed(self.hidden_layer_sizes[:-1])):
            x = Conv1DTranspose(filters=num_filters, 
                                kernel_size=3, 
                                strides=2,
                                padding="same", 
                                activation="relu", 
                                name=f"dec_deconv_{i}")(x)

        x = Conv1DTranspose(filters=self.feat_dim, 
                            kernel_size=3, 
                            strides=2,
                            padding="same", 
                            activation="relu", 
                            name="dec_deconv_final")(x)

        x = Flatten()(x)
        x = Dense(self.seq_len * self.feat_dim, name="decoder_dense_final")(x)
        residuals = Reshape((self.seq_len, self.feat_dim))(x)
        return residuals

    # ====================== Save / Load ======================
    def save(self, model_dir: str):
        os.makedirs(model_dir, exist_ok=True)
        
        # Сохраняем веса через нативный метод базового класса
        weights_base = os.path.join(model_dir, self.model_name)
        super().save_weights(weights_base)   # ← теперь native Keras!

        # Дополнительно сохраняем custom_seas (если нужно)
        if self.custom_seas is not None:
            custom_seas_serializable = [
                (int(ns), int(ls)) for ns, ls in self.custom_seas
            ]
        else:
            custom_seas_serializable = None

        # Параметры модели
        dict_params = {
            "seq_len": self.seq_len,
            "feat_dim": self.feat_dim,
            "latent_dim": self.latent_dim,
            "reconstruction_wt": self.reconstruction_wt,
            "std_loss_weight": float(self.std_loss_weight),
            "hidden_layer_sizes": list(self.hidden_layer_sizes),
            "trend_poly": self.trend_poly,
            "custom_seas": custom_seas_serializable,
            "use_residual_conn": self.use_residual_conn,
            "conditional": True,
        }
        params_file = os.path.join(model_dir, f"{self.model_name}_parameters.pkl")
        joblib.dump(dict_params, params_file)

        print(f"Conditional model fully saved to {model_dir}")

    @classmethod
    def load(cls, model_dir: str):
        """Загружает conditional модель"""
        params_file = os.path.join(model_dir, f"{cls.model_name}_parameters.pkl")
        dict_params = joblib.load(params_file)
        
        # Создаём модель
        model = ConditionalTimeVAE(**dict_params)
        
        # Загружаем веса (теперь native!)
        weights_base = os.path.join(model_dir, cls.model_name)
        model.load_weights(weights_base)
        
        # Компилируем
        model.compile(optimizer=Adam())
        
        print(f"Conditional model successfully loaded from {model_dir}")
        return model